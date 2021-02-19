var fs = require("fs");
var readline = require("readline");
var { google } = require("googleapis");
var OAuth2 = google.auth.OAuth2;
var cs = require("./client_secret.json");
var youtubedl = require("youtube-dl");
var { spotifyToken, spotifyUserId } = require("./spotify_secrets");
var superagent = require("superagent");

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
  let playlistItems;
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
        playlistItems = response.data.items;
        resolve(playlistItems);
      }
    );
  });
}

//returns array of urls
async function getPlaylistVideoUrls() {
  let videos = await getPlaylist();
  let arrayOfAllVideos = [];
  videos.forEach((element) => {
    let youtubeId = element.snippet.resourceId.videoId;
    let youtubeUrl = `https://www.youtube.com/watch?v=${youtubeId}`;
    arrayOfAllVideos.push(youtubeUrl);
  });
  return arrayOfAllVideos;
}

//get video artist and song name array
async function getVideoInfo() {
  let videoUrls = await getPlaylistVideoUrls();
  let youtubeData = [];
  for (var i = 0; i < videoUrls.length; i++) {
    youtubeData.push(getYoutubeData(videoUrls[i]));
  }
  return Promise.all(youtubeData)
    .then((results) => {
      return results;
    })
    .catch((err) => {
      console.log("error");
    });
}

//returns a JSON object containg artist and song name
function getYoutubeData(videoUrls) {
  return new Promise((resolve) => {
    youtubedl.getInfo(videoUrls, function (err, info) {
      if (err) {
        throw err;
      }
      return resolve({ artist: info.artist, songName: info.track });
    });
  });
}

//gets the spotify track URI from the extracted youtube data
async function collectUri() {
  let videoData = await getVideoInfo();
  let artist;
  let songName;
  let uriArray = [];
  for (var i = 0; i < videoData.length; i++) {
    artist = videoData[i].artist;
    songName = videoData[i].songName;
    uriArray.push(getSpotifyUri(songName, artist));
  }
  return Promise.all(uriArray)
    .then((results) => {
      return results;
    })
    .catch((err) => {
      console.log("error here");
    });
}

//generates the spotify uri
function getSpotifyUri(songName, artist) {
  let track = songName.replace(/\s/g, "%20");
  let artistNoSpace = artist.replace(/\s/g, "%20");
  return new Promise((resolve, reject) => {
    superagent
      .get(
        `https://api.spotify.com/v1/search?q=track%3A${track}+artist%3A${artistNoSpace}&type=track&limit=1`
      )
      .set({
        "Content-Type": "application/json",
        Authorization: `Bearer ${spotifyToken}`,
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
      .post(`https://api.spotify.com/v1/users/${spotifyUserId}/playlists`)
      .send({
        name: "Youtube Music Playlist",
        description: "Playlist generated from Youtube playlist",
        public: false,
      })
      .set({
        "Content-Type": "application/json",
        Authorization: `Bearer ${spotifyToken}`,
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
  let playlistId = await createSpotifyPlaylist();
  let trackUris = (await collectUri()).toString();
  console.log("tracks added: ", trackUris);
  console.log("to playlist: ", playlistId);

  superagent
    .post(
      `https://api.spotify.com/v1/playlists/${playlistId}/tracks?uris=${trackUris}`
    )
    .set({
      "Content-Type": "application/json",
      Authorization: `Bearer ${spotifyToken}`,
    })
    .end((err, res) => {
      if (err) {
        console.log(err);
      }
      return res.body;
    });
}
