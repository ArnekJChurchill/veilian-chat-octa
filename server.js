const express = require('express');
const Pusher = require('pusher');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));
app.use('/uploads', express.static('public/uploads'));

// Pusher Config
const pusher = new Pusher({
  appId: '2080160',
  key: 'b7d05dcc13df522efbbc',
  secret: '4064ce2fc0ac5596d506',
  cluster: 'us2',
  useTLS: true
});

// Simple JSON DB Helpers (no lowdb needed)
const DATA_DIR = 'data';
const DB_FILES = {
  users: `${DATA_DIR}/users.json`,
  messagesMain: `${DATA_DIR}/messages-main.json`,
  messagesMod: `${DATA_DIR}/messages-mod.json`,
  messagesPrivate: `${DATA_DIR}/messages-private.json`,
  socialPosts: `${DATA_DIR}/social-posts.json`,
  banned: `${DATA_DIR}/banned.json`
};

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath, defaults = {}) {
  ensureDir(DATA_DIR);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaults, null, 2));
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// Load all DBs
let usersDb = readJson(DB_FILES.users, { users: [] });
let mainMsgDb = readJson(DB_FILES.messagesMain, { messages: [] });
let modMsgDb = readJson(DB_FILES.messagesMod, { messages: [] });
let privateMsgDb = readJson(DB_FILES.messagesPrivate, { messages: {} });
let socialDb = readJson(DB_FILES.socialPosts, { posts: [] });
let bannedDb = readJson(DB_FILES.banned, { banned: [] });

// Multer for file uploads
const storage = multer.diskStorage({
  destination: './public/uploads/profilePics/',
  filename: (req, file, cb) => {
    cb(null, `${req.body.username}-${Date.now()}${path.extname(file.originalname)}`);
  }
});
const upload = multer({ storage });

// Ensure folders exist
ensureDir('public/uploads/profilePics');

// Default avatar (create if missing)
const defaultAvatarPath = 'public/uploads/profilePics/default.png';
if (!fs.existsSync(defaultAvatarPath)) {
  // Placeholder — add a real PNG to your repo later
  fs.writeFileSync(defaultAvatarPath, '');
}

// === ROUTES ===

// Login
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = usersDb.users.find(u => u.username === username);
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.json({ success: false, message: "Wrong username or password. Sign up if new!" });
  }
  if (bannedDb.banned.includes(username)) {
    return res.json({ success: false, message: "You are banned." });
  }
  res.json({ success: true, user: { ...user, password: undefined } });
});

// Signup
app.post('/signup', async (req, res) => {
  const { username, password } = req.body;
  if (usersDb.users.find(u => u.username === username)) {
    return res.json({ success: false, message: "Username already exists!" });
  }
  const hashed = await bcrypt.hash(password, 10);
  const newUser = {
    username,
    password: hashed,
    avatar: "/uploads/profilePics/default.png",
    bio: "Hey! I'm new to Veilian Chat.",
    joinDate: new Date().toLocaleDateString(),
    isModerator: false,
    isSupreme: username === "ArnekJChurchill",
    friends: [] // Init empty friends array
  };
  usersDb.users.push(newUser);
  writeJson(DB_FILES.users, usersDb);
  // Copy default avatar if exists
  if (fs.existsSync(defaultAvatarPath)) {
    const userAvatarPath = `public/uploads/profilePics/${username}-default.png`;
    fs.copyFileSync(defaultAvatarPath, userAvatarPath);
    newUser.avatar = `/uploads/profilePics/${username}-default.png`;
    const userIndex = usersDb.users.findIndex(u => u.username === username);
    usersDb.users[userIndex].avatar = newUser.avatar;
    writeJson(DB_FILES.users, usersDb);
  }
  res.json({ success: true, user: { ...newUser, password: undefined } });
});

// Get user data
app.get('/user/:username', (req, res) => {
  const user = usersDb.users.find(u => u.username === req.params.username);
  if (!user) return res.json({ error: "User not found" });
  res.json({ ...user, password: undefined });
});

// Update bio
app.post('/update-bio', (req, res) => {
  const { username, bio } = req.body;
  const userIndex = usersDb.users.findIndex(u => u.username === username);
  if (userIndex !== -1) {
    usersDb.users[userIndex].bio = bio;
    writeJson(DB_FILES.users, usersDb);
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});

// Upload avatar
app.post('/upload-avatar', upload.single('avatar'), (req, res) => {
  if (!req.file) return res.json({ success: false });
  const url = `/uploads/profilePics/${req.file.filename}`;
  const userIndex = usersDb.users.findIndex(u => u.username === req.body.username);
  if (userIndex !== -1) {
    usersDb.users[userIndex].avatar = url;
    writeJson(DB_FILES.users, usersDb);
    res.json({ success: true, avatar: url });
  } else {
    res.json({ success: false });
  }
});

// Ban/Unban
app.post('/ban', (req, res) => {
  const { modName, target } = req.body;
  const mod = usersDb.users.find(u => u.username === modName);
  if (!mod || (!mod.isSupreme && !mod.isModerator)) return res.json({ success: false });

  if (!bannedDb.banned.includes(target)) {
    bannedDb.banned.push(target);
    writeJson(DB_FILES.banned, bannedDb);
  }
  res.json({ success: true });
});

app.post('/unban', (req, res) => {
  const { modName, target } = req.body;
  const mod = usersDb.users.find(u => u.username === modName);
  if (!mod || (!mod.isSupreme && !mod.isModerator)) return res.json({ success: false });

  bannedDb.banned = bannedDb.banned.filter(u => u !== target);
  writeJson(DB_FILES.banned, bannedDb);
  res.json({ success: true });
});

// Add Moderator (Supreme only)
app.post('/add-moderator', (req, res) => {
  const { supremeName, target } = req.body;
  const supreme = usersDb.users.find(u => u.username === supremeName);
  if (!supreme?.isSupreme) return res.json({ success: false });
  const targetUser = usersDb.users.find(u => u.username === target);
  if (targetUser) {
    targetUser.isModerator = true;
    writeJson(DB_FILES.users, usersDb);
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});

// Pusher Auth
app.post('/pusher/auth', (req, res) => {
  const socketId = req.body.socket_id;
  const channel = req.body.channel_name;
  const username = req.body.username;

  const user = usersDb.users.find(u => u.username === username);
  if (!user) return res.status(403);

  const presenceData = {
    user_id: username,
    user_info: { username, avatar: user.avatar, isMod: user.isModerator || user.isSupreme }
  };

  const auth = pusher.authenticate(socketId, channel, presenceData);
  res.send(auth);
});

// Get/Post main chat messages
app.get('/messages/main', (req, res) => {
  res.json(mainMsgDb.messages);
});

app.post('/messages/main', (req, res) => {
  const { username, message, imageUrl } = req.body;
  const newMsg = {
    id: Date.now(),
    username,
    message,
    imageUrl: imageUrl || null,
    timestamp: new Date().toISOString()
  };
  mainMsgDb.messages.push(newMsg);
  writeJson(DB_FILES.messagesMain, mainMsgDb);
  pusher.trigger('main-chat', 'new-message', newMsg);
  res.json({ success: true });
});

// Mod chat
app.get('/messages/mod', (req, res) => {
  res.json(modMsgDb.messages);
});

app.post('/messages/mod', (req, res) => {
  const { username, message } = req.body;
  const newMsg = { id: Date.now(), username, message, timestamp: new Date().toISOString() };
  modMsgDb.messages.push(newMsg);
  writeJson(DB_FILES.messagesMod, modMsgDb);
  pusher.trigger('mod-chat', 'new-message', newMsg);
  res.json({ success: true });
});

// Private messages (keyed by sorted user pair)
app.get('/messages/private/:otherUser', (req, res) => {
  const { username } = req.query;
  const { otherUser } = req.params;
  const key = [username, otherUser].sort().join('_');
  res.json(privateMsgDb.messages[key] || []);
});

app.post('/messages/private', (req, res) => {
  const { username, otherUser, message } = req.body;
  const key = [username, otherUser].sort().join('_');
  if (!privateMsgDb.messages[key]) privateMsgDb.messages[key] = [];
  const newMsg = { id: Date.now(), from: username, message, timestamp: new Date().toISOString() };
  privateMsgDb.messages[key].push(newMsg);
  writeJson(DB_FILES.messagesPrivate, privateMsgDb);
  pusher.trigger(`private-${key}`, 'new-message', newMsg);
  res.json({ success: true });
});

// Social posts
app.get('/social/posts', (req, res) => {
  res.json(socialDb.posts);
});

app.post('/social/post', (req, res) => {
  const { username, videoUrl, title, description } = req.body;
  const newPost = {
    id: Date.now(),
    username,
    videoUrl,
    title,
    description,
    views: 0,
    likes: 0,
    dislikes: 0,
    comments: []
  };
  socialDb.posts.push(newPost);
  writeJson(DB_FILES.socialPosts, socialDb);
  pusher.trigger('social', 'new-post', newPost);
  res.json({ success: true });
});

app.post('/social/comment', (req, res) => {
  const { postId, username, comment } = req.body;
  const postIndex = socialDb.posts.findIndex(p => p.id == postId);
  if (postIndex !== -1) {
    socialDb.posts[postIndex].comments.push({
      id: Date.now(),
      username,
      comment,
      timestamp: new Date().toISOString()
    });
    writeJson(DB_FILES.socialPosts, socialDb);
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});

app.post('/social/like', (req, res) => {
  const { postId, isLike } = req.body; // true for like, false for dislike
  const postIndex = socialDb.posts.findIndex(p => p.id == postId);
  if (postIndex !== -1) {
    if (isLike) socialDb.posts[postIndex].likes++;
    else socialDb.posts[postIndex].dislikes++;
    writeJson(DB_FILES.socialPosts, socialDb);
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});

app.post('/social/view', (req, res) => {
  const { postId } = req.body;
  const postIndex = socialDb.posts.findIndex(p => p.id == postId);
  if (postIndex !== -1) {
    socialDb.posts[postIndex].views++;
    writeJson(DB_FILES.socialPosts, socialDb);
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});

// Friend system
app.post('/friends/add', (req, res) => {
  const { username, friendUsername } = req.body;
  const userIndex = usersDb.users.findIndex(u => u.username === username);
  if (userIndex !== -1 && !usersDb.users[userIndex].friends.includes(friendUsername)) {
    usersDb.users[userIndex].friends.push(friendUsername);
    writeJson(DB_FILES.users, usersDb);
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});

app.get('/friends/:username', (req, res) => {
  const user = usersDb.users.find(u => u.username === req.params.username);
  res.json(user?.friends || []);
});

// Mod view private chats
app.get('/mod/private-chats', (req, res) => {
  const { username } = req.query;
  const user = usersDb.users.find(u => u.username === username);
  if (!user || (!user.isModerator && !user.isSupreme)) return res.status(403).json({ error: "Access denied" });
  res.json(privateMsgDb.messages);
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Veilian-Chat-Octa running on port ${PORT}`);
  console.log(`Supreme Moderator: ArnekJChurchill`);
});
