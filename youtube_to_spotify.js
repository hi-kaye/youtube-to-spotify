var fs = require("fs");
var readline = require("readline");
var { google } = require("googleapis");
var OAuth2 = google.auth.OAuth2;
var cs = require("./client_secret.json");
var youtubedl = require("youtube-dl");
var { spotify_token, spotify_user_id } = require("./spotify_secrets");
var superagent = require("superagent");
var { youtube } = require("googleapis/build/src/apis/youtube");

//from google api quick start
// If modifying these scopes, delete your previously saved credentials
// at ~/.credentials/youtube-nodejs-quickstart.json
var SCOPES = ["https://www.googleapis.com/auth/youtube.readonly"];
var TOKEN_DIR =
  (process.env.HOME || process.env.HOMEPATH || process.env.USERPROFILE) +
  "/.credentials/";
var TOKEN_PATH = TOKEN_DIR + "youtube-nodejs-quickstart.json";

// Load client secrets from a local file.
fs.readFile("client_secret.json", function processClientSecrets(err, content) {
  if (err) {
    console.log("Error loading client secret file: " + err);
    return;
  }
  // Authorize a client with the loaded credentials, then call the YouTube API.
  authorize(JSON.parse(content), addSongToSpotifyPlaylist);
});

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 *
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(credentials, callback) {
  var clientSecret = cs.web.client_secret;
  var clientId = cs.web.client_id;
  var redirectUrl = cs.web.redirect_uris[0];
  var oauth2Client = new OAuth2(clientId, clientSecret, redirectUrl);

  // Check if we have previously stored a token.
  fs.readFile(TOKEN_PATH, function (err, token) {
    if (err) {
      getNewToken(oauth2Client, callback);
    } else {
      oauth2Client.credentials = JSON.parse(token);
      callback(oauth2Client);
    }
  });
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 *
 * @param {google.auth.OAuth2} oauth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback to call with the authorized
 *     client.
 */
function getNewToken(oauth2Client, callback) {
  var authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
  });
  console.log("Authorize this app by visiting this url: ", authUrl);
  var rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.question("Enter the code from that page here: ", function (code) {
    rl.close();
    oauth2Client.getToken(code, function (err, token) {
      if (err) {
        console.log("Error while trying to retrieve access token", err);
        return;
      }
      oauth2Client.credentials = token;
      storeToken(token);
      callback(oauth2Client);
    });
  });
}

/**
 * Store token to disk be used in later program executions.
 *
 * @param {Object} token The token to store to disk.
 */
function storeToken(token) {
  try {
    fs.mkdirSync(TOKEN_DIR);
  } catch (err) {
    if (err.code != "EEXIST") {
      throw err;
    }
  }
  fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
    if (err) throw err;
    console.log("Token stored to " + TOKEN_PATH);
  });
}

/**
 * Lists the names and IDs of up to 10 files.
 *
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */

async function getPlaylist(auth) {
  let playlist_items;
  let service = google.youtube("v3");
  return new Promise((resolve, reject) => {
    service.playlistItems.list(
      {
        key: cs.web.api_key,
        part: ["id, snippet"],
        maxResults: 25,
        playlistId: "PLqlSkpL5iB05v9G5Xw_H1jfCm31vqqr0t",
      },
      function (err, response) {
        if (err) {
          console.log("The API returned an error: " + err);
          reject("The API returned an error: " + err);
          return;
        }
        playlist_items = response.data.items;
        resolve(playlist_items);
      }
    );
  });
}

//returns array of urls
async function getPlaylistVideoUrls() {
  let videos = await getPlaylist();
  let arrayofallvideos = [];
  videos.forEach((element) => {
    var youtube_id = element.snippet.resourceId.videoId;
    var youtube_url = `https://www.youtube.com/watch?v=${youtube_id}`;
    arrayofallvideos.push(youtube_url);
  });
  return arrayofallvideos;
}

//get video artist and song name array
async function getVideoInfo() {
  let video_urls = await getPlaylistVideoUrls();
  let youtube_data = [];
  for (var i = 0; i < video_urls.length; i++) {
    youtube_data.push(getYoutubeData(video_urls[i]));
  }
  return Promise.all(youtube_data)
    .then((results) => {
      return results;
    })
    .catch((err) => {
      console.log("error");
    });
}

//returns a JSON object containg artist and song name
function getYoutubeData(video_urls) {
  return new Promise((resolve) => {
    youtubedl.getInfo(video_urls, function (err, info) {
      if (err) {
        throw err;
      }
      return resolve({ artist: info.artist, song_name: info.track });
    });
  });
}

//gets the spotify track URI from the extracted youtube data
async function collectUri(video_data) {
  let video_data = await getVideoInfo();
  let artist;
  let song_name;
  let uri_array = [];
  for (var i = 0; i < video_data.length; i++) {
    artist = video_data[i].artist;
    song_name = video_data[i].song_name;
    uri_array.push(getSpotifyUri(song_name, artist));
  }
  return Promise.all(uri_array)
    .then((results) => {
      return results;
    })
    .catch((err) => {
      console.log("error here");
    });
}

//generates the spotify uri
function getSpotifyUri(song_name, artist) {
  let track = song_name.replace(/\s/g, "%20");
  let artist_no_space = artist.replace(/\s/g, "%20");
  return new Promise((resolve, reject) => {
    superagent
      .get(
        `https://api.spotify.com/v1/search?q=track%3A${track}+artist%3A${artist_no_space}&type=track&limit=1`
      )
      .set({
        "Content-Type": "application/json",
        Authorization: `Bearer ${spotify_token}`,
      })
      .end((err, res) => {
        if (err) {
          console.log(err);
          reject(err);
        }
        return resolve(res.body.tracks.items[0].uri);
      });
  });
}

//creates new spotify playlist
function createSpotifyPlaylist() {
  return new Promise((resolve, reject) => {
    superagent
      .post(`https://api.spotify.com/v1/users/${spotify_user_id}/playlists`)
      .send({
        name: "Youtube Music Playlist",
        description: "Playlist generated from Youtube playlist",
        public: false,
      })
      .set({
        "Content-Type": "application/json",
        Authorization: `Bearer ${spotify_token}`,
      })
      .end((err, res) => {
        if (err) {
          console.log(err);
          reject(err);
        }
        return resolve(res.body.id);
      });
  });
}

//adds youtube playlist songs to newly created spotify playlist
async function addSongToSpotifyPlaylist() {
  let playlist_id = await createSpotifyPlaylist();
  let track_uris = (await collectUri()).toString();
  console.log("tracks added: ", track_uris);
  console.log("to playlist: ", playlist_id);

  superagent
    .post(
      `https://api.spotify.com/v1/playlists/${playlist_id}/tracks?uris=${track_uris}`
    )
    .set({
      "Content-Type": "application/json",
      Authorization: `Bearer ${spotify_token}`,
    })
    .end((err, res) => {
      if (err) {
        console.log(err);
      }
      return res.body;
    });
}
