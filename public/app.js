let user = JSON.parse(localStorage.getItem('user'));
if (!user) location.href = '/login.html';

let pusher, mainChannel, modChannel;
const myUsername = user.username;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('myUsername').textContent = user.username;
  document.getElementById('myAvatar').src = user.avatar || '/uploads/profilePics/default.png';
  document.getElementById('app').style.display = 'flex';

  // Show mod stuff if needed
  if (user.isModerator || user.isSupreme) {
    document.getElementById('modTab').style.display = 'block';
    document.getElementById('modPanel').style.display = 'block';
    if (user.isSupreme) document.getElementById('supremeSection').style.display = 'block';
  }

  // Pusher
  pusher = new Pusher('b7d05dcc13df522efbbc', { cluster: 'us2', authEndpoint: '/pusher/auth', auth: { params: { username: myUsername }}});
  mainChannel = pusher.subscribe('main-chat');
  if (user.isModerator || user.isSupreme) modChannel = pusher.subscribe('mod-chat');

  // Tabs
  document.querySelectorAll('.tab').forEach(t => {
    t.onclick = () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      document.getElementById(t.dataset.tab).classList.add('active');
      if (t.dataset.tab === 'main') loadMessages();
      if (t.dataset.tab === 'mod') loadModMessages();
    };
  });

  // Sending message
  const send = () => {
    const input = document.getElementById('msgInput');
    const text = input.value.trim();
    if (!text && !document.getElementById('imgUpload').files[0]) return;
    uploadImage().then(img => {
      fetch('/messages/main', { method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ username: myUsername, message: text, imageUrl: img })
      });
      input.value = ''; document.getElementById('imgUpload').value = '';
    });
  };
  document.getElementById('sendBtn').onclick = send;
  document.getElementById('msgInput').onkeypress = e => e.key === 'Enter' && send();

  async function uploadImage() {
    const file = document.getElementById('imgUpload').files[0];
    if (!file) return null;
    const form = new FormData();
    form.append('avatar', file);
    form.append('username', myUsername);
    const r = await fetch('/upload-avatar', { method: 'POST', body: form });
    const d = await r.json();
    return d.success ? d.avatar : null;
  }

  // Load messages
  function loadMessages() {
    fetch('/messages/main').then(r => r.json()).then(msgs => {
      const div = document.getElementById('messages');
      div.innerHTML = msgs.map(m => `
        <div class="message">
          <span class="user" onclick="openProfile('${m.username}')">${m.username}</span>: ${m.message || ''}
          ${m.imageUrl ? `<br><img src="${m.imageUrl}" onclick="this.style.maxWidth='90vw'">` : ''}
          <small style="float:right;color:#888">${new Date(m.timestamp).toLocaleTimeString()}</small>
        </div>`).join('');
      div.scrollTop = div.scrollHeight;
    });
  }
  mainChannel.bind('new-message', loadMessages);
  loadMessages();

  // Mod chat (simplified)
  function loadModMessages() { /* same pattern as main */ }

  // Profile modal
  window.openProfile = async (username = myUsername) => {
    const res = await fetch(`/user/${username}`);
    const p = await res.json();
    document.getElementById('profileAvatar').src = p.avatar || '/uploads/profilePics/default.png';
    document.getElementById('profileUsername').textContent = p.username;
    document.getElementById('profileBio').textContent = p.bio;
    document.getElementById('profileJoin').textContent = 'Joined ' + p.joinDate;
    document.getElementById('editArea').style.display = (username === myUsername) ? 'block' : 'none';
    document.getElementById('editBtn').style.display = (username === myUsername) ? 'block' : 'none';
    document.getElementById('profileModal').style.display = 'flex';
    document.getElementById('bioInput').value = p.bio || '';
  };
  document.getElementById('userBongle').onclick = () => openProfile();
  document.querySelector('.close').onclick = () => document.getElementById('profileModal').style.display = 'none';
  document.getElementById('profileAvatar').onclick = () => document.getElementById('imgUpload').click();

  document.getElementById('saveBioBtn').onclick = async () => {
    const bio = document.getElementById('bioInput').value;
    await fetch('/update-bio', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username:myUsername, bio})});
    alert('Bio saved!');
    openProfile();
  };

  document.getElementById('logoutBtn').onclick = () => {
    localStorage.clear();
    location.href = '/login.html';
  };

  // Mod buttons
  document.getElementById('banBtn').onclick = () => action('ban');
  document.getElementById('unbanBtn').onclick = () => action('unban');
  document.getElementById('makeModBtn').onclick = () => action('add-moderator');
  document.getElementById('demoteBtn').onclick = () => alert('Demote not wired yet – ask later');
  async function action(type) {
    const target = type.includes('mod') ? document.getElementById('modTarget').value : document.getElementById('banInput').value;
    if (!target) return alert('Enter username');
    await fetch(`/${type}`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ modName: myUsername, target })});
    alert('Done');
  }
});
