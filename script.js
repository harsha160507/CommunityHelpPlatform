
/* =========================================
   COMMUNITY HELP PLATFORM
   Frontend API Integration
========================================= */
const API = "http://localhost:3000/api";

const $ = (id) => document.getElementById(id);

let currentUser = null;
let currentPage = "dashboard";

const token = () => localStorage.getItem("chp_token");

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
    ...(options.headers || {})
  };

  const response = await fetch(`${API}${path}`, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401 && token()) {
      localStorage.removeItem("chp_token");
      currentUser = null;
    }

    throw new Error(data.message || data.error || "Request failed.");
  }

  return data;
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function showMessage(id, message, type = "") {
  const element = $(id);
  if (!element) return;

  element.textContent = message;
  element.className = `message ${type}`.trim();
}

function setRows(id, html, emptyMessage, columns) {
  const element = $(id);
  if (!element) return;

  element.innerHTML = html ||
    `<tr><td colspan="${columns}" class="empty-cell">${escapeHTML(emptyMessage)}</td></tr>`;
}

function formatDate(value) {
  if (!value) return "Not specified";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHTML(value);

  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

function formatTime(value) {
  if (!value) return "";

  const parts = String(value).split(":");
  if (parts.length < 2) return escapeHTML(value);

  let hour = Number(parts[0]);
  const minute = parts[1];
  const period = hour >= 12 ? "PM" : "AM";

  hour = hour % 12 || 12;

  return `${hour}:${minute} ${period}`;
}

function statusPill(status) {
  const safeStatus = String(status || "pending").toLowerCase();
  const allowed = ["pending", "approved", "rejected"];
  const value = allowed.includes(safeStatus) ? safeStatus : "pending";

  return `<span class="pill pill-${value}">${value[0].toUpperCase()}${value.slice(1)}</span>`;
}

function setAuthMode(mode) {
  const isLogin = mode === "login";

  $("loginForm").hidden = !isLogin;
  $("registerForm").hidden = isLogin;

  document.querySelectorAll(".auth-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.auth === mode);
  });
}

function updateRegistrationFields() {
  const isNGO = $("registerRole").value === "ngo";

  $("descriptionWrap").hidden = !isNGO;
  $("registerDescription").required = isNGO;
  $("interestWrap").hidden = isNGO;
}

function openPage(pageId) {
  const allowedButtons = [...document.querySelectorAll(".nav-link")];
  const selected = allowedButtons.find((button) =>
    button.dataset.page === pageId &&
    button.dataset.roles.split(",").includes(currentUser?.role)
  );

  if (!selected) pageId = "dashboard";

  currentPage = pageId;

  document.querySelectorAll(".page-section").forEach((section) => {
    section.hidden = section.id !== pageId;
  });

  document.querySelectorAll(".nav-link").forEach((button) => {
    button.classList.toggle("active", button.dataset.page === pageId);
  });

  const activeButton = document.querySelector(
    `.nav-link[data-page="${pageId}"]`
  );

  $("pageCrumb").textContent = activeButton
    ? activeButton.textContent.trim().replace(/\s+\d+$/, "")
    : "Overview";

  refreshCurrentPage();
}

function showApplication(user) {
  currentUser = user;

  $("authView").hidden = true;
  $("appView").hidden = false;

  $("profileName").textContent = user.name || "User";
  $("profileRole").textContent = user.role || "Volunteer";
  $("avatarLetter").textContent = (user.name || "U")[0].toUpperCase();
  $("topAvatar").textContent = (user.name || "U")[0].toUpperCase();

  $("welcomeTitle").textContent = `Welcome back, ${user.name || "User"}!`;

  $("welcomeSubtitle").textContent = {
    admin: "Review requests and manage your community.",
    ngo: "Manage your organisation and community events.",
    volunteer: "Discover opportunities and make a difference."
  }[user.role] || "Welcome to your community dashboard.";

  document.querySelectorAll(".nav-link").forEach((button) => {
    const roles = button.dataset.roles.split(",");
    button.hidden = !roles.includes(user.role);
  });

  $("showEventForm").hidden = user.role !== "ngo";

  openPage("dashboard");
}

function showLogin() {
  currentUser = null;
  $("authView").hidden = false;
  $("appView").hidden = true;
  setAuthMode("login");
}

async function refreshCurrentPage() {
  try {
    await loadDashboardStats();

    if (currentUser.role === "admin") {
      await loadAdminData();
    }

    if (currentUser.role === "ngo") {
      await loadNGOData();
    }

    if (currentUser.role === "volunteer") {
      await loadVolunteerData();
    }

    if (currentPage === "publicOverview") {
      await loadPublicDirectory();
    }
  } catch (error) {
    showMessage("globalMessage", error.message, "error");
  }
}

async function loadDashboardStats() {
  const stats = await api("/events/stats");

  $("volunteerCount").textContent = stats.volunteers ?? 0;
  $("ngoCount").textContent = stats.ngos ?? 0;
  $("upcomingCount").textContent = stats.events ?? 0;
  $("completedCount").textContent = stats.myParticipations ?? 0;
}

async function loadAdminData() {
  const [ngos, events, allNGOs, volunteers, allEvents] = await Promise.all([
    api("/admin/ngos/pending"),
    api("/admin/events/pending"),
    api("/admin/ngos"),
    api("/admin/volunteers"),
    api("/admin/events")
  ]);

  const pendingNGOs = ngos.ngos || [];
  const pendingEvents = events.events || [];

  $("pendingNgoCount").textContent = `${pendingNGOs.length} pending`;
  $("pendingEventCount").textContent = `${pendingEvents.length} pending`;

  $("ngoPendingBadge").textContent = pendingNGOs.length;
  $("eventPendingBadge").textContent = pendingEvents.length;

  $("ngoPendingBadge").hidden = pendingNGOs.length === 0;
  $("eventPendingBadge").hidden = pendingEvents.length === 0;

  setRows("pendingNgoTableBody", pendingNGOs.map((ngo) => `
    <tr>
      <td>${escapeHTML(ngo.name)}</td>
      <td>${escapeHTML(ngo.email)}</td>
      <td>${escapeHTML(ngo.location || "—")}</td>
      <td>${formatDate(ngo.created_at)}</td>
      <td>
        <button class="btn btn-success" data-ngo-action="approved" data-id="${Number(ngo.id)}">Approve</button>
        <button class="btn btn-danger" data-ngo-action="rejected" data-id="${Number(ngo.id)}">Reject</button>
      </td>
    </tr>
  `).join(""), "No pending NGO requests.", 5);

  setRows("pendingEventTableBody", pendingEvents.map((event) => `
    <tr>
      <td>${escapeHTML(event.title)}</td>
      <td>${escapeHTML(event.ngo_name || "NGO")}</td>
      <td>${formatDate(event.event_date)}<br>${formatTime(event.start_time)} – ${formatTime(event.end_time)}</td>
      <td>${escapeHTML(event.location)}</td>
      <td>
        <button class="btn btn-success" data-event-action="approved" data-id="${Number(event.id)}">Approve</button>
        <button class="btn btn-danger" data-event-action="rejected" data-id="${Number(event.id)}">Reject</button>
      </td>
    </tr>
  `).join(""), "No pending event requests.", 5);

  const ngoList = allNGOs.ngos || [];
  setRows("ngoTableBody", ngoList.map((ngo) => `
    <tr>
      <td>${escapeHTML(ngo.name)}</td>
      <td>${escapeHTML(ngo.email)}</td>
      <td>${escapeHTML(ngo.location || "—")}</td>
      <td>${statusPill(ngo.status)}</td>
    </tr>
  `).join(""), "No NGOs registered.", 4);

  const volunteerList = volunteers.volunteers || [];
  setRows("volunteerTableBody", volunteerList.map((volunteer) => `
    <tr>
      <td>${escapeHTML(volunteer.name)}</td>
      <td>${escapeHTML(volunteer.email)}</td>
      <td>${escapeHTML(volunteer.phone || "—")}</td>
      <td>${escapeHTML(volunteer.interest || "—")}</td>
    </tr>
  `).join(""), "No volunteers registered.", 4);

  const eventList = allEvents.events || [];
  setRows("eventTableBody", eventList.map((event) => `
    <tr>
      <td>${escapeHTML(event.title)}</td>
      <td>${escapeHTML(event.ngo_name || "NGO")}</td>
      <td>${formatDate(event.event_date)}</td>
      <td>${escapeHTML(event.location)}</td>
      <td>${statusPill(event.status)}</td>
    </tr>
  `).join(""), "No events available.", 5);

  const activities = [
    ...pendingNGOs.map((ngo) => ({
      icon: "N",
      title: "New NGO registration",
      description: `${ngo.name} is waiting for your review.`
    })),
    ...pendingEvents.map((event) => ({
      icon: "E",
      title: "New event request",
      description: `${event.title} is waiting for approval.`
    }))
  ];

  $("activityList").innerHTML = activities.length
    ? activities.map((item) => `
      <div class="activity-item">
        <div class="activity-icon">${item.icon}</div>
        <div><strong>${escapeHTML(item.title)}</strong><p>${escapeHTML(item.description)}</p></div>
      </div>
    `).join("")
    : `<p class="empty-state">No new approval requests. You're all caught up!</p>`;
}

async function loadNGOData() {
  const result = await api("/ngos/me");
  const ngo = result.ngo;

  if (ngo) {
    const banner = $("ngoStatusBanner");

    banner.innerHTML = `
      <strong>NGO status: ${escapeHTML(ngo.status)}</strong>
      <p>${ngo.status === "approved"
        ? "Your organisation is approved. You can create community events."
        : ngo.status === "rejected"
          ? "Your registration was rejected. Contact the administrator for details."
          : "Your registration is waiting for administrator approval."}</p>
    `;

    $("showEventForm").disabled = ngo.status !== "approved";
    $("showEventForm").title = ngo.status !== "approved"
      ? "Your NGO must be approved first."
      : "Create an event";
  }

  const resultEvents = await api("/events/mine");
  const myEvents = resultEvents.events || [];

  setRows("myEventsBody", myEvents.map((event) => `
    <tr>
      <td>${escapeHTML(event.title)}</td>
      <td>${formatDate(event.event_date)}<br>${formatTime(event.start_time)} – ${formatTime(event.end_time)}</td>
      <td>${escapeHTML(event.location)}</td>
      <td>${Number(event.participant_count || 0)} / ${Number(event.capacity || 0)}</td>
      <td>${statusPill(event.status)}</td>
    </tr>
  `).join(""), "You have not created any events yet.", 5);
}

async function loadVolunteerData() {
  const [eventResult, joinedResult] = await Promise.all([
    api("/events"),
    api("/volunteers/my-events")
  ]);

  const events = eventResult.events || [];
  const joined = joinedResult.events || [];
  const joinedIds = new Set(joined.map((event) => Number(event.id)));

  $("publicEventGrid").innerHTML = events.length
    ? events.map((event) => `
      <article class="event-card">
        <div class="event-card-top">
          <div class="event-category-icon">✦</div>
          ${statusPill("approved")}
        </div>
        <h3>${escapeHTML(event.title)}</h3>
        <p class="event-description">${escapeHTML(event.description || "Community volunteering opportunity.")}</p>
        <div class="event-details">
          <span>📅 ${formatDate(event.event_date)}</span>
          <span>🕒 ${formatTime(event.start_time)} – ${formatTime(event.end_time)}</span>
          <span>📍 ${escapeHTML(event.location)}</span>
        </div>
        <p class="event-organiser">Organised by ${escapeHTML(event.ngo_name || "Verified NGO")}</p>
        <p class="event-capacity">${Number(event.participant_count || 0)} / ${Number(event.capacity || 0)} participants</p>
        <button class="btn ${joinedIds.has(Number(event.id)) ? "btn-outline" : "btn-primary"}"
          data-join-event="${Number(event.id)}"
          ${joinedIds.has(Number(event.id)) || Number(event.participant_count || 0) >= Number(event.capacity || 0) ? "disabled" : ""}>
          ${joinedIds.has(Number(event.id)) ? "Already registered" : Number(event.participant_count || 0) >= Number(event.capacity || 0) ? "Event full" : "Participate"}
        </button>
      </article>
    `).join("")
    : `<p class="empty-state">No approved events are available right now. Check again later.</p>`;

  setRows("joinedEventsTableBody", joined.map((event) => `
    <tr>
      <td>${escapeHTML(event.title)}</td>
      <td>${formatDate(event.event_date)}<br>${formatTime(event.start_time)} – ${formatTime(event.end_time)}</td>
      <td>${escapeHTML(event.location)}</td>
      <td><span class="pill pill-approved">Registered</span></td>
    </tr>
  `).join(""), "You haven't joined any events yet.", 4);
}

async function loadPublicDirectory() {
  const [ngoResult, eventResult] = await Promise.all([
    api("/ngos"),
    api("/events")
  ]);

  const ngos = ngoResult.ngos || [];
  const events = eventResult.events || [];

  setRows("ngoDirectoryBody", ngos.map((ngo) => `
    <tr>
      <td>${escapeHTML(ngo.name)}</td>
      <td>${escapeHTML(ngo.location || "—")}</td>
      <td>${escapeHTML(ngo.description || "Community organisation")}</td>
    </tr>
  `).join(""), "No approved NGOs yet.", 3);

  setRows("publicEventTableBody", events.map((event) => `
    <tr>
      <td>${escapeHTML(event.title)}</td>
      <td>${escapeHTML(event.ngo_name || "Verified NGO")}</td>
      <td>${formatDate(event.event_date)}<br>${formatTime(event.start_time)} – ${formatTime(event.end_time)}</td>
      <td>${escapeHTML(event.location)}</td>
    </tr>
  `).join(""), "No approved events yet.", 4);
}

/* LOGIN */

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage("loginMessage", "Signing in...");

  try {
    const result = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: $("loginEmail").value.trim(),
        password: $("loginPassword").value
      })
    });

    localStorage.setItem("chp_token", result.token);
    showMessage("loginMessage", "");

    showApplication(result.user);
  } catch (error) {
    showMessage("loginMessage", error.message, "error");
  }
});

/* REGISTRATION */

$("registerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage("registerMessage", "Creating your account...");

  try {
    const result = await api("/auth/register", {
      method: "POST",
      body: JSON.stringify({
        name: $("registerName").value.trim(),
        email: $("registerEmail").value.trim(),
        password: $("registerPassword").value,
        role: $("registerRole").value,
        description: $("registerDescription").value.trim(),
        phone: $("registerPhone").value.trim(),
        location: $("registerLocation").value.trim(),
        interest: $("registerInterest").value.trim()
      })
    });

    showMessage(
      "registerMessage",
      result.message || "Account created. Please log in.",
      "success"
    );

    $("registerForm").reset();
    updateRegistrationFields();

    setTimeout(() => setAuthMode("login"), 1200);
  } catch (error) {
    showMessage("registerMessage", error.message, "error");
  }
});

/* AUTH TAB SWITCHING */

document.querySelectorAll("[data-auth]").forEach((button) => {
  button.addEventListener("click", () => setAuthMode(button.dataset.auth));
});

document.querySelectorAll("[data-switch-auth]").forEach((button) => {
  button.addEventListener("click", () => setAuthMode(button.dataset.switchAuth));
});

$("registerRole").addEventListener("change", updateRegistrationFields);

/* SIDEBAR NAVIGATION */

document.querySelectorAll(".nav-link").forEach((button) => {
  button.addEventListener("click", () => openPage(button.dataset.page));
});

/* ADMIN: APPROVE OR REJECT NGO / EVENT */

document.addEventListener("click", async (event) => {
  const ngoButton = event.target.closest("[data-ngo-action]");
  const eventButton = event.target.closest("[data-event-action]");
  const joinButton = event.target.closest("[data-join-event]");

  if (ngoButton) {
    const id = Number(ngoButton.dataset.id);
    const status = ngoButton.dataset.ngoAction;

    if (!id || !["approved", "rejected"].includes(status)) return;

    const oldText = ngoButton.textContent;
    ngoButton.disabled = true;
    ngoButton.textContent = "Saving...";

    try {
      await api(`/admin/ngos/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });

      showMessage("globalMessage", `NGO ${status} successfully.`, "success");
      await refreshCurrentPage();
    } catch (error) {
      showMessage("globalMessage", error.message, "error");
      ngoButton.disabled = false;
      ngoButton.textContent = oldText;
    }
  }

  if (eventButton) {
    const id = Number(eventButton.dataset.id);
    const status = eventButton.dataset.eventAction;

    if (!id || !["approved", "rejected"].includes(status)) return;

    const oldText = eventButton.textContent;
    eventButton.disabled = true;
    eventButton.textContent = "Saving...";

    try {
      await api(`/admin/events/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });

      showMessage("globalMessage", `Event ${status} successfully.`, "success");
      await refreshCurrentPage();
    } catch (error) {
      showMessage("globalMessage", error.message, "error");
      eventButton.disabled = false;
      eventButton.textContent = oldText;
    }
  }

  if (joinButton) {
    const id = Number(joinButton.dataset.joinEvent);
    if (!id) return;

    joinButton.disabled = true;
    joinButton.textContent = "Registering...";

    try {
      const result = await api(`/volunteers/events/${id}/join`, {
        method: "POST"
      });

      showMessage(
        "globalMessage",
        result.message || "You have registered for this event.",
        "success"
      );

      await loadVolunteerData();
      await loadDashboardStats();
    } catch (error) {
      showMessage("globalMessage", error.message, "error");
      joinButton.disabled = false;
      joinButton.textContent = "Participate";
    }
  }
});

/* NGO EVENT FORM */

$("showEventForm").addEventListener("click", () => {
  $("eventFormCard").hidden = false;
  $("eventFormCard").scrollIntoView({ behavior: "smooth", block: "start" });
});

$("hideEventForm").addEventListener("click", () => {
  $("eventFormCard").hidden = true;
});

$("eventForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage("eventMessage", "Submitting event for approval...");

  if ($("eventEndTime").value <= $("eventStartTime").value) {
    showMessage("eventMessage", "End time must be later than start time.", "error");
    return;
  }

  try {
    const result = await api("/events", {
      method: "POST",
      body: JSON.stringify({
        title: $("eventTitle").value.trim(),
        description: $("eventDescription").value.trim(),
        event_date: $("eventDate").value,
        location: $("eventLocation").value.trim(),
        start_time: $("eventStartTime").value,
        end_time: $("eventEndTime").value,
        capacity: Number($("eventCapacity").value)
      })
    });

    showMessage(
      "eventMessage",
      result.message || "Event submitted for admin approval.",
      "success"
    );

    $("eventForm").reset();
    $("eventCapacity").value = 20;

    await loadNGOData();
  } catch (error) {
    showMessage("eventMessage", error.message, "error");
  }
});

/* LOGOUT */

$("logoutButton").addEventListener("click", () => {
  localStorage.removeItem("chp_token");
  currentUser = null;
  showLogin();
});

/* INITIAL STARTUP */

async function startApplication() {
  updateRegistrationFields();

  if (!token()) {
    showLogin();
    return;
  }

  try {
    const result = await api("/auth/me");
    showApplication(result.user);
  } catch {
    localStorage.removeItem("chp_token");
    showLogin();
  }
}

startApplication();
