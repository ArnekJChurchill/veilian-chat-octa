let user, pusher, mainChannel, modChannel;
let currentProfileUser = null; // For viewing/editing profiles

// Check login
user = JSON.parse(localStorage.getItem('user'));
if (!user) location.href = '/login.html';

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('myUsername').textContent = user.username;
  document.getElementById('myAvatar').src = user.avatar || '/uploads/profilePics/default.png';
  document.getElementById('app').style.display = 'block';

  // Pusher setup
  pusher = new Pusher('b7d05dcc13df522efbbc', { 
    cluster: 'us2', 
    authEndpoint: '/pusher/auth', 
    auth: { params: { username: user.username } } 
  });
  mainChannel = pusher.subscribe('presence-main-chat');
  if (user.isModerator || user.isSupreme) {
    modChannel = pusher.subscribe('presence-mod-chat');
    document.getElementById('modTab').style.display = 'block';
    document.getElementById('modPanel').style.display = 'block';
    if (user.isSupreme) document.getElementById('addModBtn').style.display = 'block';
  }

  // Tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.tab).classList.add('active');
      if (tab.dataset.tab === 'main') loadMessages();
      if (tab.dataset.tab === 'mod') loadModMessages();
      if (tab.dataset.tab === 'social') loadSocial();
    };
  });

  // Send message
  document.getElementById('sendBtn').onclick = sendMessage;
  document.getElementById('msgInput').onkeypress = (e) => e.key === 'Enter' && sendMessage();

  // Image upload
  document.getElementById('imgUpload').onchange = uploadImageForChat;

  // Mod tools
  document.getElementById('banBtn').onclick = () => banUser(user.username);
  document.getElementById('unbanBtn').onclick = () => unbanUser(user.username);
  document.getElementById('addModBtn').onclick = () => addModerator(user.username);

  // Social (basic)
  document.getElementById('postVideoBtn').onclick = postVideo;

  // Load initial chat
  loadMessages();

  // Real-time listeners
  mainChannel.bind('new-message', () => {
    if (document.getElementById('main').classList.contains('active')) loadMessages();
  });
  if (modChannel) modChannel.bind('new-message', () => loadModMessages());
});

// Chat functions
async function loadMessages() {
  try {
    const res = await fetch('/messages/main');
    const msgs = await res.json();
    const div = document.getElementById('messages');
    div.innerHTML = msgs.map(m => `
      <div class="message">
        <span class="user" onclick="viewProfile('${m.username}')">${m.username}</span>: ${m.message || ''}
        ${m.imageUrl ? `<br><img src="${m.imageUrl}" style="max-width:100%; cursor:pointer;" onclick="this.style.maxWidth='90vw'" />` : ''}
        <span class="time">${new Date(m.timestamp).toLocaleTimeString()}</span>
      </div>
    `).join('');
    div.scrollTop = div.scrollHeight;
  } catch (err) { console.error('Load error:', err); }
}

async function sendMessage() {
  const input = document.getElementById('msgInput');
  const text = input.value.trim();
  if (!text) return;
  const imageUrl = await uploadImageForChat(); // Handles file if selected
  await fetch('/messages/main', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user.username, message: text, imageUrl })
  });
  input.value = '';
  document.getElementById('imgUpload').value = '';
}

async function uploadImageForChat() {
  const file = document.getElementById('imgUpload').files[0];
  if (!file) return null;
  const form = new FormData();
  form.append('avatar', file); // Reuse upload-avatar endpoint
  const res = await fetch('/upload-avatar', { method: 'POST', body: form });
  const data = await res.json();
  return data.success ? data.avatar : null;
}

// Mod chat (simple)
async function loadModMessages() {
  const res = await fetch('/messages/mod');
  const msgs = await res.json();
  const div = document.getElementById('modMessages');
  div.innerHTML = msgs.map(m => `<div class="message"><strong>${m.username}:</strong> ${m.message} <small>${new Date(m.timestamp).toLocaleTimeString()}</small></div>`).join('');
  div.scrollTop = div.scrollHeight;
}

document.getElementById('modSendBtn').onclick = async () => {
  const input = document.getElementById('modMsgInput');
  const text = input.value.trim();
  if (!text) return;
  await fetch('/messages/mod', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user.username, message: text })
  });
  input.value = '';
};

// Mod actions
async function banUser(modName) {
  const target = document.getElementById('banInput').value.trim();
  if (!target) return alert('Enter username');
  const res = await fetch('/ban', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modName, target })
  });
  const data = await res.json();
  alert(data.success ? `${target} banned!` : 'Ban failed');
  document.getElementById('banInput').value = '';
}

async function unbanUser(modName) {
  const target = document.getElementById('banInput').value.trim();
  if (!target) return alert('Enter username');
  const res = await fetch('/unban', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modName, target })
  });
  const data = await res.json();
  alert(data.success ? `${target} unbanned!` : 'Unban failed');
  document.getElementById('banInput').value = '';
}

async function addModerator(supremeName) {
  const target = prompt('Username to add as moderator:');
  if (!target) return;
  const res = await fetch('/add-moderator', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ supremeName, target })
  });
  const data = await res.json();
  alert(data.success ? `${target} is now a moderator!` : 'Failed to add moderator');
}

// Profile functions
async function openProfile(username = user.username) {
  currentProfileUser = username;
  const res = await fetch(`/user/${username}`);
  const profile = await res.json();
  if (!profile.username) return alert('User not found');
  document.getElementById('profileUsername').textContent = `@${profile.username}`;
  document.getElementById('profileAvatar').src = profile.avatar || '/uploads/profilePics/default.png';
  document.getElementById('profileBio').textContent = profile.bio;
  document.getElementById('profileJoinDate').textContent = `Joined: ${profile.joinDate}`;
  document.getElementById('editSection').style.display = username === user.username ? 'block' : 'none';
  document.getElementById('editBtn').style.display = username === user.username ? 'block' : 'none';
  if (username === user.username) document.getElementById('bioInput').value = profile.bio;
  document.getElementById('profileModal').style.display = 'flex';
}

function closeProfile() {
  document.getElementById('profileModal').style.display = 'none';
  currentProfileUser = null;
}

window.viewProfile = openProfile; // For clicking usernames in chat

// Edit profile
document.getElementById('editBtn').onclick = () => {
  document.getElementById('editSection').style.display = 'block';
  document.getElementById('editBtn').style.display = 'none';
};

document.getElementById('avatarFile').onchange = (e) => {
  const file = e.target.files[0];
  if (file) {
    const form = new FormData();
    form.append('avatar', file);
    fetch('/upload-avatar', { method: 'POST', body: form })
      .then(res => res.json())
      .then(data => {
        if (data.success) document.getElementById('profileAvatar').src = data.avatar;
      });
  }
};

document.getElementById('saveBtn').onclick = async () => {
  const bio = document.getElementById('bioInput').value;
  await fetch('/update-bio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user.username, bio })
  });
  alert('Profile saved!');
  closeProfile();
  openProfile(); // Reload to show changes
};

// Social (basic placeholder)
async function loadSocial() {
  const res = await fetch('/social/posts');
  const posts = await res.json();
  document.getElementById('posts').innerHTML = posts.map(p => `
    <div class="post">
      <h3>${p.title}</h3>
      <iframe src="${p.videoUrl}" frameborder="0" allowfullscreen></iframe>
      <p>${p.description}</p>
      <div class="stats">Views: ${p.views} | Likes: ${p.likes} | Dislikes: ${p.dislikes}</div>
    </div>
  `).join('');
}

async function postVideo() {
  const title = document.getElementById('videoTitle').value;
  const url = document.getElementById('videoUrl').value;
  const desc = document.getElementById('videoDesc').value;
  if (!title || !url) return alert('Title and URL required');
  await fetch('/social/post', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user.username, videoUrl: url, title, description: desc })
  });
  alert('Video posted!');
  document.getElementById('videoTitle').value = '';
  document.getElementById('videoUrl').value = '';
  document.getElementById('videoDesc').value = '';
  loadSocial();
}
