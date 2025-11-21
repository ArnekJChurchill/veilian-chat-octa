const express = require('express');
const Pusher = require('pusher');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const low = require('lowdb'); // v7: lowdb is the main import
const { JSONFile } = low; // v7: Adapters are now from 'lowdb'
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

// Database Setup (v7 Style: JSONFile for sync file ops)
function initDb(filePath, defaults = {}) {
  const adapter = new JSONFile(filePath);
  const db = low(adapter);
  db.data ||= defaults; // v7: Use ||= for safe defaults
  db.write();
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
if (!fs.existsSync('public/uploads/profilePics/default.png')) {
  // Simple placeholder: create a basic PNG or just use a text file for now
  fs.writeFileSync('public/uploads/profilePics/default.png', ''); // Replace with actual image later
}

// === ROUTES ===

// Login
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = usersDb.data.users.find(u => u.username === username);
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.json({ success: false, message: "Wrong username or password. Sign up if new!" });
  }
  if (bannedDb.data.banned.includes(username)) {
    return res.json({ success: false, message: "You are banned." });
  }
  res.json({ success: true, user: { ...user, password: undefined } });
});

// Signup
app.post('/signup', async (req, res) => {
  const { username, password } = req.body;
  if (usersDb.data.users.find(u => u.username === username)) {
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
  usersDb.data.users.push(newUser);
  usersDb.write();
  // Copy default avatar
  const defaultPath = 'public/uploads/profilePics/default.png';
  if (fs.existsSync(defaultPath)) {
    fs.copyFileSync(defaultPath, `public/uploads/profilePics/${username}-default.png`);
    newUser.avatar = `/uploads/profilePics/${username}-default.png`;
    const userIndex = usersDb.data.users.findIndex(u => u.username === username);
    usersDb.data.users[userIndex].avatar = newUser.avatar;
    usersDb.write();
  }
  res.json({ success: true, user: { ...newUser, password: undefined } });
});

// Get user data
app.get('/user/:username', (req, res) => {
  const user = usersDb.data.users.find(u => u.username === req.params.username);
  if (!user) return res.json({ error: "User not found" });
  res.json({ ...user, password: undefined });
});

// Update bio
app.post('/update-bio', (req, res) => {
  const { username, bio } = req.body;
  const userIndex = usersDb.data.users.findIndex(u => u.username === username);
  if (userIndex !== -1) {
    usersDb.data.users[userIndex].bio = bio;
    usersDb.write();
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});

// Upload avatar
app.post('/upload-avatar', upload.single('avatar'), (req, res) => {
  if (!req.file) return res.json({ success: false });
  const url = `/uploads/profilePics/${req.file.filename}`;
  const userIndex = usersDb.data.users.findIndex(u => u.username === req.body.username);
  if (userIndex !== -1) {
    usersDb.data.users[userIndex].avatar = url;
    usersDb.write();
    res.json({ success: true, avatar: url });
  } else {
    res.json({ success: false });
  }
});

// Ban/Unban
app.post('/ban', (req, res) => {
  const { modName, target } = req.body;
  const mod = usersDb.data.users.find(u => u.username === modName);
  if (!mod || (!mod.isSupreme && !mod.isModerator)) return res.json({ success: false });

  if (!bannedDb.data.banned.includes(target)) {
    bannedDb.data.banned.push(target);
    bannedDb.write();
  }
  res.json({ success: true });
});

app.post('/unban', (req, res) => {
  const { modName, target } = req.body;
  const mod = usersDb.data.users.find(u => u.username === modName);
  if (!mod || (!mod.isSupreme && !mod.isModerator)) return res.json({ success: false });

  bannedDb.data.banned = bannedDb.data.banned.filter(u => u !== target);
  bannedDb.write();
  res.json({ success: true });
});

// Add Moderator (Supreme only)
app.post('/add-moderator', (req, res) => {
  const { supremeName, target } = req.body;
  const supreme = usersDb.data.users.find(u => u.username === supremeName);
  if (!supreme?.isSupreme) return res.json({ success: false });
  const targetUser = usersDb.data.users.find(u => u.username === target);
  if (targetUser) {
    targetUser.isModerator = true;
    usersDb.write();
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

  const user = usersDb.data.users.find(u => u.username === username);
  if (!user) return res.status(403);

  const presenceData = {
    user_id: username,
    user_info: { username, avatar: user.avatar, isMod: user.isModerator || user.isSupreme }
  };

  const auth = pusher.authenticate(socketId, channel, presenceData);
  res.send(auth);
});

// === MISSING ROUTES FOR FULL FEATURES === (Add these for chat, social, etc.)
// Get main chat messages
app.get('/messages/main', (req, res) => {
  res.json(mainMsgDb.data.messages);
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
  mainMsgDb.data.messages.push(newMsg);
  mainMsgDb.write();
  pusher.trigger('main-chat', 'new-message', newMsg);
  res.json({ success: true });
});

// Similar for mod chat
app.get('/messages/mod', (req, res) => {
  res.json(modMsgDb.data.messages);
});

app.post('/messages/mod', (req, res) => {
  // Add mod check here if needed
  const { username, message } = req.body;
  const newMsg = { id: Date.now(), username, message, timestamp: new Date().toISOString() };
  modMsgDb.data.messages.push(newMsg);
  modMsgDb.write();
  pusher.trigger('mod-chat', 'new-message', newMsg);
  res.json({ success: true });
});

// Private messages (keyed by sorted user pair, e.g., 'user1_user2')
app.get('/messages/private/:otherUser', (req, res) => {
  const { username } = req.query;
  const { otherUser } = req.params;
  const key = [username, otherUser].sort().join('_');
  res.json(privateMsgDb.data.messages[key] || []);
});

app.post('/messages/private', (req, res) => {
  const { username, otherUser, message } = req.body;
  const key = [username, otherUser].sort().join('_');
  if (!privateMsgDb.data.messages[key]) privateMsgDb.data.messages[key] = [];
  const newMsg = { id: Date.now(), from: username, message, timestamp: new Date().toISOString() };
  privateMsgDb.data.messages[key].push(newMsg);
  privateMsgDb.write();
  pusher.trigger(`private-${key}`, 'new-message', newMsg);
  res.json({ success: true });
});

// Social posts (mini YouTube)
app.get('/social/posts', (req, res) => {
  res.json(socialDb.data.posts);
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
  socialDb.data.posts.push(newPost);
  socialDb.write();
  pusher.trigger('social', 'new-post', newPost);
  res.json({ success: true });
});

app.post('/social/comment', (req, res) => {
  const { postId, username, comment } = req.body;
  const post = socialDb.data.posts.find(p => p.id == postId);
  if (post) {
    post.comments.push({ id: Date.now(), username, comment, timestamp: new Date().toISOString() });
    socialDb.write();
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});

app.post('/social/like', (req, res) => {
  const { postId, username, isLike } = req.body; // isLike true for like, false for dislike
  const post = socialDb.data.posts.find(p => p.id == postId);
  if (post) {
    if (isLike) post.likes++; else post.dislikes++;
    socialDb.write();
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});

app.post('/social/view', (req, res) => {
  const { postId } = req.body;
  const post = socialDb.data.posts.find(p => p.id == postId);
  if (post) {
    post.views++;
    socialDb.write();
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});

// Friend system (simple array per user)
app.post('/friends/add', (req, res) => {
  const { username, friendUsername } = req.body;
  const userIndex = usersDb.data.users.findIndex(u => u.username === username);
  if (userIndex !== -1 && !usersDb.data.users[userIndex].friends) {
    usersDb.data.users[userIndex].friends = [];
  }
  if (userIndex !== -1 && !usersDb.data.users[userIndex].friends.includes(friendUsername)) {
    usersDb.data.users[userIndex].friends.push(friendUsername);
    usersDb.write();
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});

app.get('/friends/:username', (req, res) => {
  const user = usersDb.data.users.find(u => u.username === req.params.username);
  res.json(user?.friends || []);
});

// Mod view private chats (all keys)
app.get('/mod/private-chats', (req, res) => {
  const { username } = req.query;
  const user = usersDb.data.users.find(u => u.username === username);
  if (!user || (!user.isModerator && !user.isSupreme)) return res.status(403).json({ error: "Access denied" });
  res.json(privateMsgDb.data.messages);
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Veilian-Chat-Octa running on port ${PORT}`);
  console.log(`Supreme Moderator: ArnekJChurchill`);
});
