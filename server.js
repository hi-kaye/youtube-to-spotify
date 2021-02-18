const express = require("express");
const app = express();

app.use(express.json());

app.get('/oauth2callback', (req, res) =>{
    res.status(200).sendFile(__dirname + '/index.html');
})

app.listen(3000, () => console.log("Ready"))