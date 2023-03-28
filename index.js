const fs = require("fs");
const readline = require("readline");
const { google } = require("googleapis");
const { log } = require("console");

const SCOPES = [
  "https://www.googleapis.com/auth/drive.metadata",
  "https://www.googleapis.com/auth/drive.appdata",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.install",
  "https://www.googleapis.com/auth/drive",
];
const TOKEN_PATH = "token.json";

function sleep(milliseconds) {
  const date = Date.now();
  let currentDate = null;
  do {
    currentDate = Date.now();
  } while (currentDate - date < milliseconds);
}

async function authorize(credentials, callback) {
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  // Check if we have previously stored a token.

  // fs.readFile(TOKEN_PATH, async (err, token) => {
  //   if (err) return getAccessToken(oAuth2Client, callback);
  //   oAuth2Client.setCredentials(JSON.parse(token));
  //   return await callback(
  //     oAuth2Client,
  //     "",
  //     ""
  //   );
  // });

  fs.readFile(TOKEN_PATH, async (err, token) => {
    if (err) return getAccessToken(oAuth2Client, callback);
    oAuth2Client.setCredentials(JSON.parse(token));
    return await callback(
      oAuth2Client,
      "",
      ""
    );
  });
}

function getAccessToken(oAuth2Client, callback) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
  });
  console.log("Authorize this app by visiting this url:", authUrl);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.question("Enter the code from that page here: ", (code) => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
      if (err) return console.error("Error retrieving access token", err);
      oAuth2Client.setCredentials(token);
      // Store the token to disk for later program executions
      fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
        if (err) return console.error(err);
        console.log("Token stored to", TOKEN_PATH);
      });
      callback(oAuth2Client);
    });
  });
}

const baseProperties = {
  spaces: "drive",
  includeItemsFromAllDrives: false,
  includeTeamDriveItems: true,
  supportsAllDrives: true,
  supportsTeamDrives: true,
  alt: "json",
  prettyPrint: true,
  fields: "*",
};

const mapFile = (file) => {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    parents: file.parents,
  };
};

const mapFiles = (files) => {
  return files.map((file) => {
    return mapFile(file);
  });
};

const mapTime = (time) => {
  if (time.toString().length >= 2) return time;
  return `0${time}`;
};

const getNow = () => {
  const hour = new Date().getHours();
  const minute = new Date().getMinutes();
  const second = new Date().getSeconds();
  return `${mapTime(hour)}:${mapTime(minute)}:${mapTime(second)}`;
};

const listFiles = async (floderId, auth) => {
  const drive = google.drive({ version: "v3", auth });
  const metaData = {
    q: `'${floderId}' in parents and trashed = false`,
  };
  const results = new Promise((resolve) => {
    return drive.files.list({ ...metaData, ...baseProperties }, (err, res) => {
      if (err || !res.data) return resolve(null);
      return resolve(res.data.files);
    });
  });
  return await results;
};

const copyFile = async (fileId, auth) => {
  const drive = google.drive({ version: "v3", auth });
  const metaData = {
    fileId,
  };
  const results = new Promise((resolve) => {
    return drive.files.copy({ ...metaData, ...baseProperties }, (err, res) => {
      if (err || !res.data) return resolve(null);
      return resolve(res.data);
    });
  });
  return await results;
};

const moveFile = async (file, targetFloderId, auth) => {
  const drive = google.drive({ version: "v3", auth });
  const prevParents = file.parents.join(",");
  const metaData = {
    fileId: file.id,
    addParents: targetFloderId,
    removeParents: prevParents,
  };
  const results = new Promise((resolve) => {
    return drive.files.update(
      { ...metaData, ...baseProperties },
      (err, res) => {
        if (err || !res.data) return resolve(null);
        return resolve(res.data);
      }
    );
  });
  return await results;
};

const createFolder = async (name, targetFloderId, auth) => {
  const drive = google.drive({ version: "v3", auth });
  const metaData = {
    resource: {
      name: name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [targetFloderId],
    },
  };
  const results = new Promise((resolve) => {
    return drive.files.create(
      { ...metaData, ...baseProperties },
      (err, res) => {
        if (err || !res.data) return resolve(null);
        return resolve(res.data);
      }
    );
  });
  return await results;
};

const duplicateFolder = async (auth, sourceId, targetId) => {
  sleep(3000);
  let sourceFiles = await listFiles(sourceId, auth);
  if (!sourceFiles) {
    log(`> ${getNow()} > Failed List Files: "${sourceId}"`);
    return;
  }
  sourceFiles = mapFiles(sourceFiles);
  for (const item of sourceFiles) {
    if (item.mimeType !== "application/vnd.google-apps.folder") {
      await new Promise(async (next) => {
        log(`> ${getNow()} > Coping File: "${item.name}"`);
        let fileCopied = await copyFile(item.id, auth);
        if (!fileCopied) {
          log(`> ${getNow()} > Failed Copy File: "${item.name}"`);
          return next();
        }
        fileCopied = mapFile(fileCopied);
        await sleep(3000);
        log(`> ${getNow()} > Copied File: "${fileCopied.name}"`);
        log(`> ${getNow()} > Moving File: "${fileCopied.name}"`);
        let fileMoved = await moveFile(fileCopied, targetId, auth);
        if (!fileMoved) {
          log(`> ${getNow()} > Failed Moving File: "${item.name}"`);
          return next();
        }
        fileMoved = mapFile(fileMoved);
        await sleep(3000);
        log(`> ${getNow()} > Moved File: "${fileMoved.name}"`);
        next();
      });
    } else {
      await new Promise(async (next) => {
        log(`> ${getNow()} > Creating Folder: "${item.name}"`);
        let folderCreated = await createFolder(item.name, targetId, auth);
        if (!folderCreated) {
          log(`> ${getNow()} > Failed Create Folder: "${item.name}"`);
          return next();
        }
        folderCreated = mapFile(folderCreated);
        await sleep(3000);
        log(`> ${getNow()} > Created Folder: "${folderCreated.name}"`);
        log(`> ${getNow()} > Process files in folder: "${folderCreated.name}"`);
        await duplicateFolder(auth, item.id, folderCreated.id);
        next();
      });
    }
  }
};

fs.readFile("credentials.json", async (err, content) => {
  if (err) return console.log("Error loading client secret file:", err);
  await authorize(JSON.parse(content), duplicateFolder);
});
