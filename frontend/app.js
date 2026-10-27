"use strict";
const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let token = sessionStorage.getItem("chp_session"),
  user = null,
  epoch = 0,
  controller = null,
  renderId = 0,
  items = new Map(),
  config = { timezone: "UTC" };
const routes = {
  events: ["Community events", "guest,admin,ngo,volunteer"],
  directory: ["NGO directory", "guest,admin,ngo,volunteer"],
  dashboard: ["Overview & activity", "admin,ngo,volunteer"],
  mine: ["My NGO events", "ngo"],
  joined: ["My registrations", "volunteer"],
  ngos: ["Review NGOs", "admin"],
  reviews: ["Review events", "admin"],
  volunteers: ["Manage volunteers", "admin"],
  audit: ["Review history", "admin"],
  account: ["My account", "admin,ngo,volunteer"],
  login: ["Log in", "guest"],
  register: ["Create account", "guest"],
  recovery: ["Account recovery", "guest"],
  verify: ["Verify email", "guest"],
  reset: ["Reset password", "guest"],
  edit: ["Create or edit event", "ngo"],
  participants: ["Event participants", "ngo"],
};
function state() {
  const raw = location.hash.slice(1) || "events",
    i = raw.indexOf("?");
  return {
    page: i < 0 ? raw : raw.slice(0, i),
    params: new URLSearchParams(i < 0 ? "" : raw.slice(i + 1)),
  };
}
function message(text, type = "") {
  $("notice").textContent = text;
  $("notice").className = "message " + type;
}
function clearSession() {
  epoch++;
  token = null;
  user = null;
  sessionStorage.removeItem("chp_session");
  controller?.abort();
  items.clear();
  $("content").replaceChildren();
  $("notice").textContent = "";
}
function renderNavigation() {
  const role = user?.role || "guest";
  $("profileName").textContent = user?.name || "Community explorer";
  $("profileRole").textContent = role;
  $("logout").hidden = !user;
  $("sideNav").innerHTML = Object.entries(routes)
    .filter(
      ([key, r]) =>
        !["edit", "participants", "verify", "reset"].includes(key) &&
        r[1].split(",").includes(role),
    )
    .map(
      ([key, r]) =>
        '<a class="nav-link" href="#' +
        key +
        '"' +
        (state().page === key ? ' aria-current="page"' : "") +
        ">" +
        esc(r[0]) +
        "</a>",
    )
    .join("");
}
async function api(path, options = {}) {
  const oldToken = token,
    oldEpoch = epoch;
  const response = await fetch("/api" + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(oldToken ? { Authorization: "Bearer " + oldToken } : {}),
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (oldEpoch !== epoch)
    throw new DOMException("Obsolete session", "AbortError");
  if (!response.ok) {
    if (response.status === 401 && oldToken && oldToken === token) {
      clearSession();
      location.hash = "login";
      renderNavigation();
      render();
      message("Your session expired or was revoked. Please log in.", "error");
    }
    throw new Error(data.message || "The request failed.");
  }
  return data;
}
const field = (label, name, type = "text", value = "", attrs = "") =>
  "<label>" +
  esc(label) +
  '<input name="' +
  name +
  '" type="' +
  type +
  '" value="' +
  esc(value) +
  '" ' +
  attrs +
  "></label>";
const area = (label, name, value = "", attrs = "") =>
  "<label>" +
  esc(label) +
  '<textarea name="' +
  name +
  '" rows="3" ' +
  attrs +
  ">" +
  esc(value) +
  "</textarea></label>";
const button = (text, attrs = "") =>
  '<button class="btn btn-primary" ' + attrs + ">" + esc(text) + "</button>";
const action = (label, kind, id, attrs = "") =>
  button(
    label,
    'type="button" data-action="' + kind + '" data-id="' + id + '" ' + attrs,
  );
const form = (kind, body, label, attrs = "") =>
  '<form data-kind="' +
  kind +
  '" ' +
  attrs +
  ' class="form-card">' +
  body +
  '<div class="form-actions">' +
  button(label, 'type="submit"') +
  "</div></form>";
function profileFields(p = {}) {
  return (
    field(
      "Full name / organisation name",
      "name",
      "text",
      p.name || "",
      'required maxlength="100" autocomplete="name"',
    ) +
    field(
      "Phone",
      "phone",
      "tel",
      p.phone || "",
      'maxlength="30" autocomplete="tel"',
    ) +
    field(
      "Location",
      "location",
      "text",
      p.location || "",
      'maxlength="200" autocomplete="address-level2"',
    ) +
    field(
      "Interests",
      "interest",
      "text",
      p.interest || "",
      'maxlength="255"',
    ) +
    area(
      "About your NGO (required for NGO accounts)",
      "description",
      p.description || "",
      'maxlength="10000"' + (p.role === "ngo" ? " required" : ""),
    )
  );
}
const emailField = () =>
  field(
    "Email address",
    "email",
    "email",
    "",
    'required maxlength="190" autocomplete="email"',
  );
const newPassword = () =>
  field(
    "New password (12+ characters; maximum 72 UTF-8 bytes)",
    "password",
    "password",
    "",
    'required minlength="12" maxlength="72" autocomplete="new-password"',
  );
function details(e) {
  return (
    "<h2>" +
    esc(e.title) +
    '</h2><p class="preserve">' +
    esc(e.description) +
    "</p><p>" +
    esc(e.event_date) +
    " · " +
    esc(e.start_time.slice(0, 5)) +
    "–" +
    esc(e.end_time.slice(0, 5)) +
    " (" +
    esc(config.timezone) +
    ")</p><p>" +
    esc(e.location) +
    " · " +
    esc(e.ngo_name) +
    "</p>" +
    "<p>Review: <strong>" +
    esc(e.status) +
    "</strong> · Event: <strong>" +
    esc(e.lifecycle) +
    "</strong> · Organizer: " +
    esc(e.ngo_disabled ? "disabled" : e.ngo_status) +
    "</p>" +
    (e.rejection_reason
      ? '<p class="message error">Review feedback: ' +
        esc(e.rejection_reason) +
        "</p>"
      : "")
  );
}
function pager(p) {
  return !p
    ? ""
    : '<div class="pagination"><p>Page ' +
        p.page +
        " of " +
        p.pages +
        " · " +
        p.total +
        " results</p>" +
        (p.page > 1 ? action("Previous", "page", p.page - 1) : "") +
        (p.page < p.pages ? action("Next", "page", p.page + 1) : "") +
        "</div>";
}
function reviewControls(kind, item) {
  return (
    '<form data-kind="review" data-entity="' +
    kind +
    '" data-id="' +
    item.id +
    '" class="review-form">' +
    area("Reason (required when rejecting)", "reason", "", 'maxlength="1000"') +
    '<button type="submit" value="approved" class="btn btn-success">Approve / restore</button> <button type="submit" value="rejected" class="btn btn-danger">Reject / revoke</button></form>'
  );
}
async function render({ quiet = false } = {}) {
  const id = ++renderId,
    oldEpoch = epoch;
  controller?.abort();
  controller = new AbortController();
  const options = { signal: controller.signal },
    s = state(),
    role = user?.role || "guest",
    route = routes[s.page];
  if (!route || !route[1].split(",").includes(role)) {
    location.hash = user ? "dashboard" : "events";
    return;
  }
  renderNavigation();
  $("pageTitle").textContent = route[0];
  document.title = route[0] + " · Community Help";
  if (!quiet) {
    $("pageTitle").focus();
    $("content").replaceChildren();
    $("content").setAttribute("aria-busy", "true");
  }
  const query =
    "?page=" + encodeURIComponent(s.params.get("page") || "1") + "&limit=12";
  let html = "";
  try {
    if (user) user = (await api("/auth/me", options)).user;
    switch (s.page) {
      case "login":
        html =
          form(
            "login",
            emailField() +
              field(
                "Password",
                "password",
                "password",
                "",
                'required maxlength="72" autocomplete="current-password"',
              ),
            "Log in",
          ) +
          '<p><a href="#recovery">Forgot password or need verification?</a></p>';
        break;
      case "register":
        html = form(
          "register",
          profileFields() +
            emailField() +
            newPassword() +
            '<label>Register as<select name="role"><option value="volunteer">Volunteer</option><option value="ngo">NGO</option></select></label><p>Verify your email before signing in. NGO accounts also require administrator review.</p>',
          "Create account",
        );
        break;
      case "recovery":
        html =
          form("forgot-password", emailField(), "Send password reset link") +
          form(
            "request-verification",
            emailField(),
            "Resend verification link",
          );
        break;
      case "verify":
      case "reset":
        html = form(
          s.page,
          field(
            "Email link token",
            "token",
            "text",
            s.params.get("token") || "",
            'required minlength="64" maxlength="64" autocomplete="off"',
          ) + (s.page === "reset" ? newPassword() : ""),
          s.page === "verify" ? "Verify email" : "Reset password",
        );
        if (s.params.has("token")) history.replaceState(null, "", "#" + s.page);
        break;
      case "account":
        html =
          "<p>Email: " +
          esc(user.email) +
          " · Review: " +
          esc(user.status) +
          "</p>" +
          (user.rejection_reason
            ? '<p class="message error">' + esc(user.rejection_reason) + "</p>"
            : "") +
          (user.role === "ngo"
            ? "<p>Saving your NGO profile resubmits it for review. Your events are hidden until it is approved.</p>"
            : "") +
          form("profile", profileFields(user), "Save profile / resubmit") +
          form(
            "change-password",
            field(
              "Current password",
              "currentPassword",
              "password",
              "",
              'required autocomplete="current-password"',
            ) + newPassword(),
            "Change password and sign out",
          ) +
          (user.role !== "admin"
            ? form(
                "delete-account",
                "<h2>Delete account</h2><p>This removes your identity fields, signs you out and cancels your scheduled NGO events. Historical event records remain.</p>" +
                  field(
                    "Confirm password",
                    "password",
                    "password",
                    "",
                    'required autocomplete="current-password"',
                  ) +
                  '<label><input type="checkbox" name="confirm" required> I want to delete my account.</label>',
                "Delete my account",
              )
            : "");
        break;
      case "dashboard": {
        const [stats, data] = await Promise.all([
          api("/stats", options),
          api("/activity" + query, options),
        ]);
        html =
          '<p class="muted">This overview refreshes every 30 seconds while visible.</p><div class="stats-grid">' +
          [
            ["Active volunteers", stats.volunteers],
            ["Approved NGOs", stats.ngos],
            ["Upcoming events", stats.events],
          ]
            .map(
              ([label, count]) =>
                '<article class="stat-card"><span>' +
                label +
                "</span><strong>" +
                Number(count) +
                "</strong></article>",
            )
            .join("") +
          "</div><h2>Your activity</h2>" +
          data.activity
            .map(
              (a) =>
                '<article class="activity-item"><p>' +
                esc(a.message) +
                "<br><small>" +
                esc(a.created_at) +
                "</small></p></article>",
            )
            .join("") +
          (!data.activity.length ? "<p>No account updates yet.</p>" : "") +
          pager(data.pagination);
        break;
      }
      case "directory": {
        const data = await api("/ngos" + query, options);
        html =
          '<div class="event-grid">' +
          data.ngos
            .map(
              (n) =>
                '<article class="event-card"><h2>' +
                esc(n.name) +
                "</h2><p>" +
                esc(n.location || "Location not supplied") +
                '</p><p class="preserve">' +
                esc(n.description) +
                "</p></article>",
            )
            .join("") +
          "</div>" +
          (!data.ngos.length ? "<p>No approved NGOs yet.</p>" : "") +
          pager(data.pagination);
        break;
      }
      case "events":
      case "mine":
      case "joined":
      case "reviews": {
        const endpoint = {
            events: "/events",
            mine: "/events/mine",
            joined: "/volunteers/my-events",
            reviews: "/admin/events",
          }[s.page],
          data = await api(endpoint + query, options);
        if (oldEpoch !== epoch || id !== renderId) return;
        items = new Map(data.events.map((e) => [String(e.id), e]));
        html =
          (s.page === "mine"
            ? '<p><a class="btn btn-primary" href="#edit">Create event</a></p><p>NGO review: ' +
              esc(user.status) +
              ". Use My account to update and resubmit a rejected NGO profile.</p>"
            : "") +
          '<div class="event-grid">' +
          data.events
            .map(
              (e) =>
                '<article class="event-card">' +
                details(e) +
                (e.participant_count !== undefined
                  ? "<p>" +
                    Number(e.participant_count) +
                    " / " +
                    Number(e.capacity) +
                    " participants</p>"
                  : "") +
                (s.page === "events"
                  ? user?.role === "volunteer"
                    ? action(
                        "Participate",
                        "join",
                        e.id,
                        Number(e.participant_count) >= Number(e.capacity)
                          ? "disabled"
                          : "",
                      )
                    : !user
                      ? '<a href="#login">Log in to participate</a>'
                      : ""
                  : "") +
                (s.page === "joined"
                  ? "<p>Attendance: " +
                    (e.attended ? "recorded" : "not recorded") +
                    "</p>" +
                    (e.lifecycle !== "completed"
                      ? action("Withdraw", "withdraw", e.id)
                      : "")
                  : "") +
                (s.page === "mine"
                  ? '<div class="form-actions"><a href="#participants?id=' +
                    e.id +
                    '">Participants</a>' +
                    (e.lifecycle === "scheduled"
                      ? '<a href="#edit?id=' +
                        e.id +
                        '">Edit / resubmit</a>' +
                        action("Cancel event", "cancel", e.id) +
                        action("Mark completed", "complete", e.id)
                      : "") +
                    "</div>"
                  : "") +
                (s.page === "reviews" && e.lifecycle === "scheduled"
                  ? reviewControls("events", e)
                  : "") +
                "</article>",
            )
            .join("") +
          "</div>" +
          (!data.events.length ? "<p>No events on this page.</p>" : "") +
          pager(data.pagination);
        break;
      }
      case "ngos":
      case "volunteers": {
        const data = await api("/admin/" + s.page + query, options),
          list = data[s.page];
        if (oldEpoch !== epoch || id !== renderId) return;
        items = new Map(list.map((u) => [String(u.id), u]));
        html =
          list
            .map(
              (u) =>
                '<article class="form-card"><h2>' +
                esc(u.name) +
                "</h2><p>" +
                esc(u.email) +
                " · " +
                esc(u.phone || "No phone") +
                " · " +
                esc(u.location || "No location") +
                "</p><p>Email " +
                (u.email_verified ? "verified" : "unverified") +
                " · " +
                esc(u.status) +
                " · " +
                (u.disabled ? "disabled" : "active") +
                '</p><p class="preserve">' +
                esc(u.description || u.interest || "No additional details") +
                "</p>" +
                (u.rejection_reason
                  ? "<p>Feedback: " + esc(u.rejection_reason) + "</p>"
                  : "") +
                (s.page === "ngos"
                  ? reviewControls("ngos", u)
                  : action(
                      u.disabled ? "Restore account" : "Disable account",
                      "disable",
                      u.id,
                    )) +
                "</article>",
            )
            .join("") +
          (!list.length ? "<p>No accounts on this page.</p>" : "") +
          pager(data.pagination);
        break;
      }
      case "audit": {
        const data = await api("/admin/audit" + query, options);
        html =
          '<div class="table-scroll"><table><caption>Review and account history</caption><thead><tr><th scope="col">Who</th><th scope="col">Action</th><th scope="col">Record</th><th scope="col">When (UTC)</th></tr></thead><tbody>' +
          data.activity
            .map(
              (a) =>
                "<tr><td>" +
                esc(a.actor_name || "Former account") +
                "</td><td>" +
                esc(a.action) +
                "</td><td>" +
                esc(a.entity) +
                " " +
                Number(a.entity_id) +
                "</td><td>" +
                esc(a.created_at) +
                "</td></tr>",
            )
            .join("") +
          "</tbody></table></div>" +
          pager(data.pagination);
        break;
      }
      case "edit": {
        let e = {};
        if (s.params.has("id"))
          e = (
            await api(
              "/events/" + encodeURIComponent(s.params.get("id")) + "/owner",
              options,
            )
          ).event;
        if (oldEpoch !== epoch || id !== renderId) return;
        items = new Map(e.id ? [[String(e.id), e]] : []);
        html = form(
          "event",
          field(
            "Title",
            "title",
            "text",
            e.title || "",
            'required maxlength="200"',
          ) +
            area(
              "Description",
              "description",
              e.description || "",
              'required maxlength="10000"',
            ) +
            field(
              "Date",
              "event_date",
              "date",
              e.event_date || "",
              "required",
            ) +
            field(
              "Start time (" + config.timezone + ")",
              "start_time",
              "time",
              e.start_time?.slice(0, 5) || "",
              "required",
            ) +
            field(
              "End time (same day)",
              "end_time",
              "time",
              e.end_time?.slice(0, 5) || "",
              "required",
            ) +
            field(
              "Location",
              "location",
              "text",
              e.location || "",
              'required maxlength="255"',
            ) +
            field(
              "Volunteer capacity",
              "capacity",
              "number",
              e.capacity || 20,
              'required min="1" max="10000" step="1"',
            ),
          e.id ? "Submit changes for review" : "Submit for review",
          'data-id="' +
            (e.id || "") +
            '" data-key="' +
            crypto.randomUUID() +
            '"',
        );
        break;
      }
      case "participants": {
        const eventId = s.params.get("id"),
          [data, owner] = await Promise.all([
            api(
              "/events/" +
                encodeURIComponent(eventId) +
                "/participants" +
                query,
              options,
            ),
            api("/events/" + encodeURIComponent(eventId) + "/owner", options),
          ]);
        html =
          '<p><a href="#mine">Back to my events</a></p><h2>' +
          esc(owner.event.title) +
          "</h2>" +
          data.participants
            .map(
              (p) =>
                '<article class="activity-item"><p>' +
                esc(p.name) +
                " · " +
                esc(p.email) +
                " · " +
                esc(p.phone || "No phone") +
                "<br>Attendance: " +
                (p.attended ? "recorded" : "not recorded") +
                "</p>" +
                (owner.event.lifecycle === "completed"
                  ? action(
                      p.attended ? "Clear attendance" : "Record attendance",
                      "attendance",
                      p.id,
                      'data-event="' +
                        Number(eventId) +
                        '" data-attended="' +
                        (p.attended ? "false" : "true") +
                        '"',
                    )
                  : "") +
                "</article>",
            )
            .join("") +
          (!data.participants.length
            ? "<p>No registered volunteers.</p>"
            : "") +
          pager(data.pagination);
        break;
      }
    }
    if (id !== renderId || oldEpoch !== epoch) return;
    $("content").innerHTML = html;
    $("content").setAttribute("aria-busy", "false");
    $("connection").textContent =
      "Updated " +
      new Date().toLocaleTimeString() +
      " · Event timezone: " +
      config.timezone;
  } catch (error) {
    if (error.name === "AbortError" || id !== renderId || oldEpoch !== epoch)
      return;
    $("content").setAttribute("aria-busy", "false");
    message(error.message, "error");
  }
}
document.addEventListener("change", (event) => {
  if (event.target.name === "role") {
    event.target.form.elements.description.required =
      event.target.value === "ngo";
  }
});
document.addEventListener("submit", async (event) => {
  const f = event.target.closest("form[data-kind]");
  if (!f) return;
  event.preventDefault();
  if (f.dataset.busy) return;
  const buttons = [...f.querySelectorAll("button")];
  f.dataset.busy = "1";
  buttons.forEach((b) => (b.disabled = true));
  const values = Object.fromEntries(new FormData(f)),
    kind = f.dataset.kind,
    oldEpoch = epoch;
  try {
    if (
      ["register", "reset", "change-password"].includes(kind) &&
      new TextEncoder().encode(values.password).length > 72
    )
      throw new Error("Password must be at most 72 UTF-8 bytes.");
    let result;
    if (kind === "login") {
      result = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify(values),
      });
      token = result.token;
      sessionStorage.setItem("chp_session", token);
      epoch++;
      user = (await api("/auth/me")).user;
      location.hash = "dashboard";
      await render();
    } else if (kind === "event") {
      const id = f.dataset.id,
        e = items.get(id);
      result = await api("/events" + (id ? "/" + id : ""), {
        method: id ? "PUT" : "POST",
        headers: { "Idempotency-Key": f.dataset.key },
        body: JSON.stringify({
          ...values,
          capacity: Number(values.capacity),
          ...(e ? { version: e.version } : {}),
        }),
      });
      location.hash = "mine";
      await render();
    } else if (kind === "review") {
      const e = items.get(f.dataset.id);
      result = await api("/admin/" + f.dataset.entity + "/" + e.id, {
        method: "PATCH",
        body: JSON.stringify({
          status: event.submitter.value,
          reason: values.reason,
          version: e.version,
          expectedStatus: e.status,
        }),
      });
      await render();
    } else if (kind === "profile") {
      result = await api("/auth/profile", {
        method: "PUT",
        body: JSON.stringify({ ...values, version: user.version }),
      });
      user = (await api("/auth/me")).user;
      await render();
    } else if (kind === "delete-account") {
      result = await api("/auth/account", {
        method: "DELETE",
        body: JSON.stringify(values),
      });
      clearSession();
      location.hash = "events";
      await render();
    } else {
      result = await api("/auth/" + kind, {
        method: "POST",
        body: JSON.stringify(values),
      });
      if (kind === "change-password") {
        clearSession();
        location.hash = "login";
        await render();
      } else f.reset();
    }
    message(result.message || "Saved.", "success");
  } catch (error) {
    if (error.name !== "AbortError" && (epoch === oldEpoch || kind === "login"))
      message(error.message, "error");
  } finally {
    delete f.dataset.busy;
    buttons.forEach((b) => (b.disabled = false));
  }
});
document.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]");
  if (!target || target.disabled) return;
  const kind = target.dataset.action,
    id = target.dataset.id;
  if (kind === "page") {
    const s = state();
    s.params.set("page", id);
    location.hash = s.page + "?" + s.params;
    return;
  }
  target.disabled = true;
  const oldEpoch = epoch;
  try {
    const item = items.get(id);
    let path,
      method = "POST",
      body = {};
    if (kind === "join" || kind === "withdraw") {
      path = "/volunteers/events/" + id + "/join";
      method = kind === "join" ? "POST" : "DELETE";
    }
    if (kind === "cancel" || kind === "complete") {
      path = "/events/" + id + "/" + kind;
      body = { version: item.version };
    }
    if (kind === "disable") {
      path = "/admin/volunteers/" + id;
      method = "PATCH";
      body = { disabled: !item.disabled, version: item.version };
    }
    if (kind === "attendance") {
      path = "/events/" + target.dataset.event + "/participants/" + id;
      method = "PATCH";
      body = { attended: target.dataset.attended === "true" };
    }
    if (!path) return;
    const result = await api(path, { method, body: JSON.stringify(body) });
    if (oldEpoch !== epoch) return;
    await render();
    message(result.message, "success");
  } catch (error) {
    if (error.name !== "AbortError" && oldEpoch === epoch)
      message(error.message, "error");
  } finally {
    target.disabled = false;
  }
});
$("logout").addEventListener("click", async () => {
  const oldEpoch = epoch;
  try {
    await api("/auth/logout", { method: "POST", body: "{}" });
  } catch (error) {
    if (error.name !== "AbortError" && epoch === oldEpoch) {
      message(
        "Could not confirm server logout. Retry while connected.",
        "error",
      );
      return;
    }
  }
  clearSession();
  location.hash = "events";
  await render();
  message("Signed out.", "success");
});
$("refresh").addEventListener("click", () => render());
window.addEventListener("hashchange", () => {
  message("");
  render();
});
setInterval(() => {
  if (!document.hidden && state().page === "dashboard") render({ quiet: true });
}, 30000);
async function start() {
  try {
    config = await api("/config");
    if (token) {
      try {
        user = (await api("/auth/me")).user;
      } catch {
        clearSession();
      }
    }
    await render();
    if (config.developmentMailPreview)
      message(
        "Development mail preview: read verification/reset links locally with npm run mail:preview.",
      );
  } catch (error) {
    message(error.message, "error");
  }
}
document.querySelector(".skip-link").addEventListener("click", (event) => {
  event.preventDefault();
  $("main").focus();
});
start();
