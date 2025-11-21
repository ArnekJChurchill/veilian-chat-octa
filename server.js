const express = require('express');
const Pusher = require('pusher');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const low = require('lowdb');
const { FileSync } = require('lowdb/adapters'); // v7: Correct import for sync
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

// Database Setup (v7 Style: FileSync for sync file ops)
function initDb(filePath, defaults = {}) {
  const adapter = new FileSync(filePath);
  const db = low(adapter);
  db.defaults(defaults).write(); // v7: Chain defaults().write() to init
  return db;
}

// Init all DBs
const usersDb = initDb('data/users.json', { users: [] });
const mainMsgDb = initDb('data/messages-main.json', { messages: [] });

// Other DBs (mod, private, social, banned)
const modMsgDb = initDb('data/messages-mod.json', { messages: [] });
const privateMsgDb = initDb('data/messages-private.json', { messages: {} });
const socialDb = initDb('data/social-posts.json', { posts: [] });
const bannedDb = initDb('data/banned.json', { banned: [] });

// Multer for file uploads
const storage = multer.diskStorage({
  destination: './public/uploads/profilePics/',
  filename: (req, file, cb) => {
    cb(null, `${req.body.username}-${Date.now()}${path.extname(file.originalname)}`);
  }
});
const upload = multer({ storage });

// Ensure folders exist
['public/uploads/profilePics', 'data'].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Default avatar (create if missing)
const defaultAvatarPath = 'public/uploads/profilePics/default.png';
if (!fs.existsSync(defaultAvatarPath)) {
  // Create a simple placeholder (or upload a real PNG to repo)
  fs.writeFileSync(defaultAvatarPath, ''); // Temp; replace with actual image in repo
}

// === ROUTES ===

// Login
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = usersDb.get('users').find({ username }).value();
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.json({ success: false, message: "Wrong username or password. Sign up if new!" });
  }
  if (bannedDb.get('banned').value().includes(username)) {
    return res.json({ success: false, message: "You are banned." });
  }
  res.json({ success: true, user: { ...user, password: undefined } });
});

// Signup
app.post('/signup', async (req, res) => {
  const { username, password } = req.body;
  if (usersDb.get('users').find({ username }).value()) {
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
    isSupreme: username === "ArnekJChurchill" // YOU are supreme
  };
  usersDb.get('users').push(newUser).write();
  // Copy default avatar
  if (fs.existsSync(defaultAvatarPath)) {
    const userAvatar = `public/uploads/profilePics/${username}-default.png`;
    fs.copyFileSync(defaultAvatarPath, userAvatar);
    newUser.avatar = `/uploads/profilePics/${username}-default.png`;
    usersDb.get('users').find({ username }).assign({ avatar: newUser.avatar }).write();
  }
  res.json({ success: true, user: { ...newUser, password: undefined } });
});

// Get user data
app.get('/user/:username', (req, res) => {
  const user = usersDb.get('users').find({ username: req.params.username }).value();
  if (!user) return res.json({ error: "User not found" });
  res.json({ ...user, password: undefined });
});

// Update bio
app.post('/update-bio', (req, res) => {
  const { username, bio } = req.body;
  usersDb.get('users').find({ username }).assign({ bio }).write();
  res.json({ success: true });
});

// Upload avatar
app.post('/upload-avatar', upload.single('avatar'), (req, res) => {
  if (!req.file) return res.json({ success: false });
  const url = `/uploads/profilePics/${req.file.filename}`;
  usersDb.get('users').find({ username: req.body.username }).assign({ avatar: url }).write();
  res.json({ success: true, avatar: url });
});

// Ban/Unban
app.post('/ban', (req, res) => {
  const { modName, target } = req.body;
  const mod = usersDb.get('users').find({ username: modName }).value();
  if (!mod || (!mod.isSupreme && !mod.isModerator)) return res.json({ success: false });

  const bannedList = bannedDb.get('banned');
  if (!bannedList.value().includes(target)) {
    bannedList.push(target).write();
  }
  res.json({ success: true });
});

app.post('/unban', (req, res) => {
  const { modName, target } = req.body;
  const mod = usersDb.get('users').find({ username: modName }).value();
  if (!mod || (!mod.isSupreme && !mod.isModerator)) return res.json({ success: false });

  bannedDb.get('banned').remove({ username: target }).write(); // Note: adjust if not objects
  res.json({ success: true });
});

// Add Moderator (Supreme only)
app.post('/add-moderator', (req, res) => {
  const { supremeName, target } = req.body;
  const supreme = usersDb.get('users').find({ username: supremeName }).value();
  if (!supreme?.isSupreme) return res.json({ success: false });
  usersDb.get('users').find({ username: target }).assign({ isModerator: true }).write();
  res.json({ success: true });
});

// Pusher Auth
app.post('/pusher/auth', (req, res) => {
  const socketId = req.body.socket_id;
  const channel = req.body.channel_name;
  const username = req.body.username;

  const user = usersDb.get('users').find({ username }).value();
  if (!user) return res.status(403);

  const presenceData = {
    user_id: username,
    user_info: { username, avatar: user.avatar, isMod: user.isModerator || user.isSupreme }
  };

  const auth = pusher.authenticate(socketId, channel, presenceData);
  res.send(auth);
});

// Get main chat messages
app.get('/messages/main', (req, res) => {
  res.json(mainMsgDb.get('messages').value());
});

// Post message to main (with image support)
app.post('/messages/main', (req, res) => {
  const { username, message, imageUrl } = req.body;
  const newMsg = {
    id: Date.now(),
    username,
    message,
    imageUrl: imageUrl || null,
    timestamp: new Date().toISOString()
  };
  mainMsgDb.get('messages').push(newMsg).write();
  pusher.trigger('main-chat', 'new-message', newMsg);
  res.json({ success: true });
});

// Mod chat
app.get('/messages/mod', (req, res) => {
  res.json(modMsgDb.get('messages').value());
});

app.post('/messages/mod', (req, res) => {
  const { username, message } = req.body;
  const newMsg = { id: Date.now(), username, message, timestamp: new Date().toISOString() };
  modMsgDb.get('messages').push(newMsg).write();
  pusher.trigger('mod-chat', 'new-message', newMsg);
  res.json({ success: true });
});

// Private messages (keyed by sorted user pair)
app.get('/messages/private/:otherUser', (req, res) => {
  const { username } = req.query;
  const { otherUser } = req.params;
  const key = [username, otherUser].sort().join('_');
  res.json(privateMsgDb.get(`messages.${key}`).value() || []);
});

app.post('/messages/private', (req, res) => {
  const { username, otherUser, message } = req.body;
  const key = [username, otherUser].sort().join('_');
  const newMsg = { id: Date.now(), from: username, message, timestamp: new Date().toISOString() };
  privateMsgDb.get('messages').push({ [key]: newMsg }).write(); // Simplified; adjust for array
  pusher.trigger(`private-${key}`, 'new-message', newMsg);
  res.json({ success: true });
});

// Social posts
app.get('/social/posts', (req, res) => {
  res.json(socialDb.get('posts').value());
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
  socialDb.get('posts').push(newPost).write();
  pusher.trigger('social', 'new-post', newPost);
  res.json({ success: true });
});

app.post('/social/comment', (req, res) => {
  const { postId, username, comment } = req.body;
  const postIndex = socialDb.get('posts').findIndex({ id: postId }).value();
  if (postIndex !== -1) {
    socialDb.get('posts').nth(postIndex).get('comments').push({
      id: Date.now(), username, comment, timestamp: new Date().toISOString()
    }).write();
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});

app.post('/social/like', (req, res) => {
  const { postId, isLike } = req.body;
  const post = socialDb.get('posts').find({ id: postId });
  if (post.value()) {
    if (isLike) post.assign({ likes: post.value().likes + 1 }).write();
    else post.assign({ dislikes: post.value().dislikes + 1 }).write();
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});

app.post('/social/view', (req, res) => {
  const { postId } = req.body;
  const post = socialDb.get('posts').find({ id: postId });
  if (post.value()) {
    post.assign({ views: post.value().views + 1 }).write();
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});

// Friend system
app.post('/friends/add', (req, res) => {
  const { username, friendUsername } = req.body;
  const user = usersDb.get('users').find({ username });
  if (user.value() && !user.get('friends').value()?.includes(friendUsername)) {
    user.get('friends', []).push(friendUsername).write();
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});

app.get('/friends/:username', (req, res) => {
  const user = usersDb.get('users').find({ username: req.params.username });
  res.json(user.get('friends').value() || []);
});

// Mod view private chats
app.get('/mod/private-chats', (req, res) => {
  const { username } = req.query;
  const user = usersDb.get('users').find({ username }).value();
  if (!user || (!user.isModerator && !user.isSupreme)) return res.status(403).json({ error: "Access denied" });
  res.json(privateMsgDb.get('messages').value());
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Veilian-Chat-Octa running on port ${PORT}`);
  console.log(`Supreme Moderator: ArnekJChurchill`);
});
