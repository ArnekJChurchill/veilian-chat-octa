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

// Pusher (your keys)
const pusher = new Pusher({
  appId: '2080160',
  key: 'b7d05dcc13df522efbbc',
  secret: '4064ce2fc0ac5596d506',
  cluster: 'us2',
  useTLS: true
});

// Simple JSON DB helpers
const DATA_DIR = 'data';
function read(file, def) {
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(def, null, 2));
  return JSON.parse(fs.readFileSync(file));
}
function write(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

let users = read('data/users.json', { users: [] });
let mainMsgs = read('data/messages-main.json', { messages: [] });
let modMsgs = read('data/messages-mod.json', { messages: [] });
let privateMsgs = read('data/messages-private.json', { messages: {} });
let social = read('data/social-posts.json', { posts: [] });
let banned = read('data/banned.json', { banned: [] });

// Ensure folders
['public/uploads/profilePics', 'data'].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});
if (!fs.existsSync('public/uploads/profilePics/default.png')) {
  fs.writeFileSync('public/uploads/profilePics/default.png', ''); // add your own default later
}

// Multer upload
const storage = multer.diskStorage({
  destination: './public/uploads/profilePics/',
  filename: (req, file, cb) => cb(null, `${req.body.username}-${Date.now()}${path.extname(file.originalname)}`)
});
const upload = multer({ storage });

// Routes
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = users.users.find(u => u.username === username);
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.json({ success: false, message: "Wrong username/password. Sign up if new!" });
  }
  if (banned.banned.includes(username)) return res.json({ success: false, message: "You are banned." });
  res.json({ success: true, user: { ...user, password: undefined } });
});

app.post('/signup', async (req, res) => {
  const { username, password } = req.body;
  if (users.users.find(u => u.username === username)) {
    return res.json({ success: false, message: "Username already exists!" });
  }
  const hashed = await bcrypt.hash(password, 10);
  const newUser = {
    username,
    password: hashed,
    avatar: "/uploads/profilePics/default.png",
    bio: "New to Veilian Chat Octa",
    joinDate: new Date().toLocaleDateString(),
    isModerator: false,
    isSupreme: username === "ArnekJChurchill"
  };
  users.users.push(newUser);
  write('data/users.json', users);
  res.json({ success: true, user: { ...newUser, password: undefined } });
});

app.get('/user/:username', (req, res) => {
  const user = users.users.find(u => u.username === req.params.username);
  res.json(user ? { ...user, password: undefined } : { error: "Not found" });
});

app.post('/update-bio', (req, res) => {
  const { username, bio } = req.body;
  const user = users.users.find(u => u.username === username);
  if (user) { user.bio = bio; write('data/users.json', users); res.json({ success: true }); }
});

app.post('/upload-avatar', upload.single('avatar'), (req, res) => {
  if (!req.file) return res.json({ success: false });
  const url = `/uploads/profilePics/${req.file.filename}`;
  const user = users.users.find(u => u.username === req.body.username);
  if (user) { user.avatar = url; write('data/users.json', users); }
  res.json({ success: true, avatar: url });
});

// Mod actions
app.post('/ban', (req, res) => {
  const { modName, target } = req.body;
  const mod = users.users.find(u => u.username === modName);
  if (mod && (mod.isModerator || mod.isSupreme)) {
    if (!banned.banned.includes(target)) banned.banned.push(target);
    write('data/banned.json', banned);
    res.json({ success: true });
  }
});
app.post('/unban', (req, res) => { /* same as ban but filter */ });
app.post('/add-moderator', (req, res) => {
  const { supremeName, target } = req.body;
  const supreme = users.users.find(u => u.username === supremeName);
  if (supreme?.isSupreme) {
    const targetUser = users.users.find(u => u.username === target);
    if (targetUser) { targetUser.isModerator = true; write('data/users.json', users); }
    res.json({ success: true });
  }
});

// Chat routes (main, mod, private, social) – same as previous working version
app.get('/messages/main', (req, res) => res.json(mainMsgs.messages));
app.post('/messages/main', (req, res) => {
  const msg = { ...req.body, id: Date.now(), timestamp: new Date().toISOString() };
  mainMsgs.messages.push(msg); write('data/messages-main.json', mainMsgs);
  pusher.trigger('main-chat', 'new-message', msg);
  res.json({ success: true });
});
// ... (mod chat, private chat, social routes – identical to previous working version)

app.post('/pusher/auth', (req, res) => {
  const socketId = req.body.socket_id;
  const channel = req.body.channel_name;
  const username = req.body.username;
  const user = users.users.find(u => u.username === username);
  if (!user) return res.status(403).send('Forbidden');
  const presenceData = { user_id: username, user_info: { username, avatar: user.avatar } };
  const auth = pusher.authenticate(socketId, channel, presenceData);
  res.send(auth);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Veilian-Chat-Octa live on port ${PORT}`));
