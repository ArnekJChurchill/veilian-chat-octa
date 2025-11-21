const express = require('express');
const Pusher = require('pusher');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
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

// Database
const adapter = new FileSync('data/users.json');
const db = low(adapter);
db.defaults({ users: [] }).write();

const msgAdapter = new FileSync('data/messages-main.json');
const msgDb = low(msgAdapter);
msgDb.defaults({ messages: [] }).write();

// Other DBs
['messages-mod.json', 'messages-private.json', 'social-posts.json', 'banned.json'].forEach(file => {
  const a = new FileSync(`data/${file}`);
  const d = low(a);
  if (file === 'banned.json') d.defaults({ banned: [] }).write();
  else if (file === 'social-posts.json') d.defaults({ posts: [] }).write();
  else d.defaults({ messages: {} }).write();
});

// Multer for file uploads
const storage = multer.diskStorage({
  destination: './public/uploads/profilePics/',
  filename: (req, file, cb) => {
    cb(null, `${req.body.username}-${Date.now()}${path.extname(file.originalname)}`);
  }
});
const upload = multer({ storage });

// Ensure folders exist
fs.mkdirSync('public/uploads/profilePics', { recursive: true });
fs.mkdirSync('data', { recursive: true });

// === ROUTES ===

// Login
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = db.get('users').find({ username }).value();
  if (!user || !await bcrypt.compare(password, user.password)) {
    return res.json({ success: false, message: "Wrong username or password. Sign up if new!" });
  }
  const banned = low(new FileSync('data/banned.json')).get('banned').value();
  if (banned.includes(username)) {
    return res.json({ success: false, message: "You are banned." });
  }
  res.json({ success: true, user: { ...user, password: undefined } });
});

// Signup
app.post('/signup', async (req, res) => {
  const { username, password } = req.body;
  if (db.get('users').find({ username }).value()) {
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
  db.get('users').push(newUser).write();
  fs.copyFileSync('public/uploads/profilePics/default.png', `public/uploads/profilePics/${username}-default.png`);
  newUser.avatar = `/uploads/profilePics/${username}-default.png`;
  db.get('users').find({ username }).assign({ avatar: newUser.avatar }).write();
  res.json({ success: true, user: { ...newUser, password: undefined } });
});

// Get user data
app.get('/user/:username', (req, res) => {
  const user = db.get('users').find({ username: req.params.username }).value();
  if (!user) return res.json({ error: "User not found" });
  res.json({ ...user, password: undefined });
});

// Update bio
app.post('/update-bio', (req, res) => {
  const { username, bio } = req.body;
  db.get('users').find({ username }).assign({ bio }).write();
  res.json({ success: true });
});

// Upload avatar
app.post('/upload-avatar', upload.single('avatar'), (req, res) => {
  if (!req.file) return res.json({ success: false });
  const url = `/uploads/profilePics/${req.file.filename}`;
  db.get('users').find({ username: req.body.username }).assign({ avatar: url }).write();
  res.json({ success: true, avatar: url });
});

// Ban/Unban
app.post('/ban', (req, res) => {
  const { modName, target } = req.body;
  const mod = db.get('users').find({ username: modName }).value();
  if (!mod || (!mod.isSupreme && !mod.isModerator)) return res.json({ success: false });

  const bannedDb = low(new FileSync('data/banned.json'));
  let banned = bannedDb.get('banned').value();
  if (!banned.includes(target)) {
    banned.push(target);
    bannedDb.set('banned', banned).write();
  }
  res.json({ success: true });
});

app.post('/unban', (req, res) => {
  const { modName, target } = req.body;
  const mod = db.get('users').find({ username: modName }).value();
  if (!mod || (!mod.isSupreme && !mod.isModerator)) return res.json({ success: false });

  const bannedDb = low(new FileSync('data/banned.json'));
  let banned = bannedDb.get('banned').value();
  banned = banned.filter(u => u !== target);
  bannedDb.set('banned', banned).write();
  res.json({ success: true });
});

// Add Moderator (Supreme only)
app.post('/add-moderator', (req, res) => {
  const { supremeName, target } = req.body;
  const supreme = db.get('users').find({ username: supremeName }).value();
  if (!supreme?.isSupreme) return res.json({ success: false });
  db.get('users').find({ username: target }).assign({ isModerator: true }).write();
  res.json({ success: true });
});

// Pusher Auth
app.post('/pusher/auth', (req, res) => {
  const socketId = req.body.socket_id;
  const channel = req.body.channel_name;
  const username = req.body.username;

  const user = db.get('users').find({ username }).value();
  if (!user) return res.status(403);

  const presenceData = {
    user_id: username,
    user_info: { username, avatar: user.avatar, isMod: user.isModerator || user.isSupreme }
  };

  const auth = pusher.authenticate(socketId, channel, presenceData);
  res.send(auth);
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Veilian-Chat-Octa running on port ${PORT}`);
  console.log(`Supreme Moderator: ArnekJChurchill`);
});
