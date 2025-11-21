// State
let currentUser = null;

// DOM Elements
const authSection = document.getElementById('auth-section');
const feedSection = document.getElementById('feed-section');
const profileSection = document.getElementById('profile-section');
const navLinks = document.getElementById('nav-links');
const loginForm = document.getElementById('login');
const registerForm = document.getElementById('register');
const createPostForm = document.getElementById('create-post-form');
const postsContainer = document.getElementById('posts-container');

// Init
async function init() {
    try {
        const res = await fetch('/api/me');
        if (res.ok) {
            const data = await res.json();
            currentUser = data.user;
            showFeed();
        } else {
            showAuth();
        }
    } catch (e) {
        showAuth();
    }
}

// Navigation
function showAuth() {
    authSection.classList.remove('hidden');
    feedSection.classList.add('hidden');
    profileSection.classList.add('hidden');
    navLinks.classList.add('hidden');
}

function showFeed() {
    authSection.classList.add('hidden');
    feedSection.classList.remove('hidden');
    profileSection.classList.add('hidden');
    navLinks.classList.remove('hidden');
    loadPosts();
}

async function showProfile(username) {
    authSection.classList.add('hidden');
    feedSection.classList.add('hidden');
    profileSection.classList.remove('hidden');

    const targetUser = username || currentUser.username;

    try {
        const [userRes, postsRes] = await Promise.all([
            fetch(`/api/users/${targetUser}`),
            fetch(`/api/users/${targetUser}/posts`)
        ]);

        if (!userRes.ok) throw new Error('User not found');

        const user = await userRes.json();
        const posts = await postsRes.json();

        renderProfile(user, posts);
    } catch (e) {
        console.error(e);
        alert('Error loading profile');
    }
}

// Auth Handlers
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData);

    const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });

    if (res.ok) {
        const resData = await res.json();
        currentUser = resData.user;
        loginForm.reset();
        showFeed();
    } else {
        alert('Login failed');
    }
});

registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData);

    const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });

    if (res.ok) {
        const resData = await res.json();
        currentUser = resData.user;
        registerForm.reset();
        showFeed();
    } else {
        alert('Registration failed');
    }
});

document.getElementById('show-register').addEventListener('click', () => {
    document.getElementById('login-form').classList.add('hidden');
    document.getElementById('register-form').classList.remove('hidden');
});

document.getElementById('show-login').addEventListener('click', () => {
    document.getElementById('register-form').classList.add('hidden');
    document.getElementById('login-form').classList.remove('hidden');
});

document.getElementById('nav-logout').addEventListener('click', async (e) => {
    e.preventDefault();
    await fetch('/api/logout', { method: 'POST' });
    currentUser = null;
    showAuth();
});

document.getElementById('nav-home').addEventListener('click', (e) => {
    e.preventDefault();
    showFeed();
});

document.getElementById('nav-profile').addEventListener('click', (e) => {
    e.preventDefault();
    showProfile();
});

// Post Handlers
createPostForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const content = e.target.content.value;

    const res = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
    });

    if (res.ok) {
        createPostForm.reset();
        loadPosts();
    }
});

async function loadPosts() {
    const res = await fetch('/api/posts');
    const posts = await res.json();
    renderPosts(posts, postsContainer);
}

function renderPosts(posts, container) {
    container.innerHTML = posts.map(post => `
        <div class="post">
            <div class="post-header">
                <div class="avatar">${post.username[0].toUpperCase()}</div>
                <div>
                    <div class="username">
                        <a href="#" onclick="showProfile('${post.username}'); return false;" style="color: inherit;">${post.username}</a>
                    </div>
                    <div class="timestamp">${new Date(post.created_at).toLocaleDateString()}</div>
                </div>
            </div>
            <div class="post-content">${post.content}</div>
            <div class="post-actions">
                <button class="action-btn ${post.is_liked ? 'active' : ''}" onclick="toggleLike(${post.id})">
                    <span>${post.is_liked ? '❤️' : '🤍'}</span> ${post.like_count}
                </button>
                <button class="action-btn" onclick="toggleComments(${post.id})">
                    <span>💬</span> ${post.comment_count}
                </button>
            </div>
            <div id="comments-${post.id}" class="comments-section hidden">
                <div id="comments-list-${post.id}"></div>
                <form onsubmit="submitComment(event, ${post.id})" style="margin-top: 10px; display: flex; gap: 10px;">
                    <input type="text" name="content" placeholder="Write a comment..." required style="margin-bottom: 0;">
                    <button type="submit" style="width: auto;">Send</button>
                </form>
            </div>
        </div>
    `).join('');
}

async function toggleLike(postId) {
    await fetch(`/api/posts/${postId}/like`, { method: 'POST' });
    // Reload posts to update UI (naive approach for simplicity)
    if (!feedSection.classList.contains('hidden')) {
        loadPosts();
    } else {
        // If on profile, reload profile posts
        const username = document.querySelector('.profile-header .username').innerText;
        showProfile(username);
    }
}

async function toggleComments(postId) {
    const section = document.getElementById(`comments-${postId}`);
    section.classList.toggle('hidden');

    if (!section.classList.contains('hidden')) {
        const res = await fetch(`/api/posts/${postId}/comments`);
        const comments = await res.json();
        const list = document.getElementById(`comments-list-${postId}`);
        list.innerHTML = comments.map(c => `
            <div class="comment">
                <div class="avatar" style="width: 24px; height: 24px; font-size: 0.8rem;">${c.username[0].toUpperCase()}</div>
                <div class="comment-content">
                    <div class="comment-author">${c.username}</div>
                    <div class="comment-text">${c.content}</div>
                </div>
            </div>
        `).join('');
    }
}

async function submitComment(e, postId) {
    e.preventDefault();
    const content = e.target.content.value;

    await fetch(`/api/posts/${postId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
    });

    e.target.reset();
    toggleComments(postId); // Reload comments
}

// Profile Rendering
function renderProfile(user, posts) {
    const isSelf = currentUser && currentUser.id === user.id;
    const followBtn = !isSelf ? `
        <button onclick="toggleFollow('${user.username}')" style="width: auto; margin-top: 10px;">
            ${user.is_following ? 'Unfollow' : 'Follow'}
        </button>
    ` : '';

    profileSection.innerHTML = `
        <div class="profile-header">
            <div class="avatar profile-avatar">${user.username[0].toUpperCase()}</div>
            <h2 class="username">${user.username}</h2>
            ${followBtn}
            <div class="profile-stats">
                <div class="stat-item">
                    <span class="stat-value">${user.post_count}</span>
                    <span class="stat-label">Posts</span>
                </div>
                <div class="stat-item">
                    <span class="stat-value">${user.followers_count}</span>
                    <span class="stat-label">Followers</span>
                </div>
                <div class="stat-item">
                    <span class="stat-value">${user.following_count}</span>
                    <span class="stat-label">Following</span>
                </div>
            </div>
        </div>
        <div id="profile-posts"></div>
    `;

    renderPosts(posts, document.getElementById('profile-posts'));
}

async function toggleFollow(username) {
    await fetch(`/api/users/${username}/follow`, { method: 'POST' });
    showProfile(username);
}

// Start
init();
