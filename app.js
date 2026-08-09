(() => {
  const cfg = window.PUBLIC_NOTEBOOK_CONFIG || {};
  const page = document.body.dataset.page;

  const PAGE_SIZE = 10;
  const MAX_CONTENT = 20000;
  const MAX_TITLE = 120;
  const MAX_SKETCH_CHARS = 4000000;

  const $ = (id) => document.getElementById(id);
  const setText = (id, value) => { const node = $(id); if (node) node.textContent = value; };

  function esc(value) {
    const div = document.createElement("div");
    div.textContent = value == null ? "" : String(value);
    return div.innerHTML;
  }

  function plain(html) {
    const div = document.createElement("div");
    div.innerHTML = html || "";
    return (div.textContent || div.innerText || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }

  function date(value) {
    return new Date(value).toLocaleString(undefined, {
      year: "numeric", month: "short", day: "2-digit", hour: "numeric", minute: "2-digit"
    });
  }

  function query(name) {
    return new URLSearchParams(location.search).get(name);
  }

  function safeHtml(html) {
    if (!window.DOMPurify) return esc(plain(html));
    return DOMPurify.sanitize(html || "", {
      ALLOWED_TAGS: ["b", "strong", "i", "em", "u", "p", "br", "div", "blockquote", "ul", "ol", "li"],
      ALLOWED_ATTR: []
    });
  }

  function configured() {
    return cfg.supabaseUrl && cfg.supabaseKey &&
      !cfg.supabaseUrl.includes("PASTE_YOUR") &&
      !cfg.supabaseKey.includes("PASTE_YOUR");
  }

  if (!configured()) {
    ["page-status", "write-status", "topic-status", "auth-status"].forEach((id) => {
      setText(id, "Supabase is not configured. Check config.js.");
    });
    return;
  }

  const supabase = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);
  let session = null;
  let currentUser = null;

  async function initAuth() {
    const { data } = await supabase.auth.getSession();
    session = data.session || null;
    currentUser = session ? session.user : null;
    renderAuth();
  }

  function renderAuth() {
    const label = $("auth-label");
    const button = $("auth-button");
    const community = $("community-button");
    const name = currentUser?.user_metadata?.username || currentUser?.email?.split("@")[0] || "user";

    if (label) label.textContent = currentUser ? `@${name}` : "";
    if (button) {
      button.textContent = currentUser ? "ACCOUNT" : "LOGIN";
      button.href = currentUser ? "account.html" : "login.html";
    }
    if (community && currentUser) {
      community.textContent = "ACCOUNT";
      community.href = "account.html";
    }
  }

  async function getProfile(userId) {
    const r = await supabase.from("profiles")
      .select("id,username,display_name,bio,avatar_url,created_at")
      .eq("id", userId).maybeSingle();
    return r.data || null;
  }

  function setupDrawer() {
    const sidebar = $("topic-sidebar");
    const backdrop = $("drawer-backdrop");
    const open = () => { sidebar?.classList.add("open"); backdrop?.classList.add("open"); };
    const close = () => { sidebar?.classList.remove("open"); backdrop?.classList.remove("open"); };
    $("topics-toggle")?.addEventListener("click", open);
    $("topics-close")?.addEventListener("click", close);
    backdrop?.addEventListener("click", close);
  }

  function renderPagination(container, current, total, callback) {
    if (!container) return;
    if (total <= 1) { container.innerHTML = ""; return; }
    let html = `<button ${current <= 1 ? "disabled" : ""} data-p="${current - 1}">←</button>`;
    for (let p = Math.max(1, current - 2); p <= Math.min(total, current + 2); p++) {
      html += `<button class="${p === current ? "active" : ""}" data-p="${p}">${p}</button>`;
    }
    html += `<button ${current >= total ? "disabled" : ""} data-p="${current + 1}">→</button>`;
    container.innerHTML = html;
    container.querySelectorAll("button:not(:disabled)").forEach((button) => {
      button.addEventListener("click", () => callback(Number(button.dataset.p)));
    });
  }

  async function loadTopics(pageNo = Number(query("topics_page") || 1)) {
    const list = $("topic-list");
    if (!list) return;
    const from = (pageNo - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const r = await supabase.from("topics")
      .select("id,name,description,owner_id,created_at,profiles(username,display_name)", { count: "exact" })
      .order("created_at", { ascending: false }).range(from, to);

    if (r.error) {
      list.innerHTML = `<div class="muted">${esc(r.error.message)}</div>`;
      return;
    }

    list.innerHTML = (r.data || []).map((topic) => `
      <a class="topic-link" href="topic.html?id=${encodeURIComponent(topic.id)}">
        <strong>${esc(topic.name)}</strong>
        <small>@${esc(topic.profiles?.username || "user")}</small>
      </a>
    `).join("") || `<div class="muted">No community topics yet.</div>`;

    renderPagination($("topic-pagination"), pageNo, Math.max(1, Math.ceil((r.count || 0) / PAGE_SIZE)), (p) => {
      const url = new URL(location.href);
      url.searchParams.set("topics_page", p);
      history.pushState({}, "", url);
      loadTopics(p);
    });
  }

  async function loadProgress() {
    const box = $("progress-box");
    if (!box) return;
    if (!currentUser) {
      box.innerHTML = `<h3>TOPIC CREATION</h3><p>Login and submit notes to GENERAL to unlock your own topic.</p><a class="action-button blue" href="login.html">LOGIN</a>`;
      return;
    }

    const r = await supabase.rpc("get_general_note_count", { p_user_id: currentUser.id });
    if (r.error) {
      box.innerHTML = `<p class="muted">Progress unavailable.</p>`;
      return;
    }

    const count = Number(r.data || 0);
    const pct = Math.min(100, count / 20 * 100);
    box.innerHTML = `
      <h3>TOPIC CREATION</h3>
      <div class="progress-bar"><span style="width:${pct}%"></span></div>
      <p><strong>${count} / 20</strong> GENERAL notes</p>
      ${count >= 20 ? `<a class="action-button green" href="create-topic.html">CREATE TOPIC</a>` : `<p>Submit ${20 - count} more to unlock.</p>`}
    `;
  }

  async function getTopic(topicId) {
    if (!topicId || topicId === "general") {
      return { id: "general", name: "GENERAL", description: "A public place for shared thoughts.", owner_id: null, isGeneral: true };
    }

    const r = await supabase.from("topics")
      .select("id,name,description,owner_id,created_at,profiles(id,username,display_name,bio,avatar_url)")
      .eq("id", topicId).maybeSingle();
    if (r.error || !r.data) return null;
    return { ...r.data, isGeneral: false };
  }

  async function loadNotes(topic, pageNo = Number(query("page") || 1)) {
    const list = $("note-list");
    if (!list) return;

    const from = (pageNo - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    let request = supabase.from("notes")
      .select("id,topic_id,author_id,title,content,sketch_data,created_at,updated_at,profiles(username,display_name)", { count: "exact" });

    request = topic.isGeneral ? request.is("topic_id", null) : request.eq("topic_id", topic.id);
    const r = await request.order("created_at", { ascending: false }).range(from, to);

    if (r.error) {
      setText("page-status", `Could not load notes: ${r.error.message}`);
      return;
    }

    setText("page-status", r.data?.length ? "" : "No notes have been posted here yet.");
    list.innerHTML = (r.data || []).map((note) => {
      const owner = topic.isGeneral ? "Anonymous" : (note.profiles?.display_name || note.profiles?.username || "User");
      const manage = !topic.isGeneral && currentUser && note.author_id === currentUser.id && topic.owner_id === currentUser.id;
      return `
        <article class="note-card">
          <div class="note-main">
            <div class="note-author">${esc(owner)}</div>
            <h2>${esc(note.title)}</h2>
            <p>${esc(excerpt(note.content))}</p>
          </div>
          <div class="note-side">
            <div class="posted">Posted: ${esc(date(note.created_at))}</div>
            <div class="note-actions">
              <a class="read-button" href="note.html?id=${encodeURIComponent(note.id)}">READ →</a>
              ${manage ? `<a class="edit-link" href="edit-note.html?id=${encodeURIComponent(note.id)}">EDIT</a><button class="delete-link" data-delete="${esc(note.id)}">DELETE</button>` : ""}
            </div>
          </div>
        </article>
      `;
    }).join("");

    list.querySelectorAll("[data-delete]").forEach((button) => {
      button.addEventListener("click", () => deleteNote(button.dataset.delete, topic));
    });

    renderPagination($("note-pagination"), pageNo, Math.max(1, Math.ceil((r.count || 0) / PAGE_SIZE)), (p) => {
      const url = new URL(location.href);
      url.searchParams.set("page", p);
      history.pushState({}, "", url);
      loadNotes(topic, p);
    });
  }

  async function deleteNote(id, topic) {
    if (!currentUser || topic.isGeneral || !confirm("Delete this note permanently?")) return;
    const r = await supabase.from("notes").delete().eq("id", id);
    if (r.error) alert(`Delete failed: ${r.error.message}`);
    else loadNotes(topic, Number(query("page") || 1));
  }

  function renderOwner(topic) {
    const panel = $("owner-panel");
    if (!panel) return;

    if (topic.isGeneral) {
      panel.innerHTML = `
        <div class="owner-badge"><img src="assets/logo.png" alt="Public Notebook"></div>
        <h2>GENERAL</h2>
        <p>Registered members can upload notes readable by the public. Upon posting 20 notes, users can create a topic of their own.</p>
        <p class="muted">Submitted notes in General are permanently read-only.</p>
      `;
      return;
    }

    const profile = topic.profiles || {};
    panel.innerHTML = `
      <div class="owner-avatar">${esc((profile.username || "U").slice(0, 1).toUpperCase())}</div>
      <h2>@${esc(profile.username || "user")}</h2>
      <p>${esc(profile.bio || "This is my public notebook topic.")}</p>
    `;
  }

  async function loadTopicPage() {
    setupDrawer();
    await initAuth();
    await loadTopics();
    await loadProgress();

    const topic = await getTopic(query("id") || "general");
    if (!topic) {
      setText("current-topic-name", "Topic not found");
      setText("page-status", "This topic does not exist.");
      return;
    }

    setText("current-topic-name", topic.name);
    setText("current-topic-description", topic.description || "");
    renderOwner(topic);

    const write = $("write-button");
    if (write) {
      const allowed = topic.isGeneral ? !!currentUser : !!currentUser && currentUser.id === topic.owner_id;
      write.style.display = allowed ? "inline-flex" : "none";
      write.href = topic.isGeneral ? "write.html?topic=general" : `write.html?topic=${encodeURIComponent(topic.id)}`;
    }

    await loadNotes(topic);
    const general = document.querySelector(".general-link");
    if (general) general.classList.toggle("active", topic.isGeneral);
  }

  function setupToolbar() {
    document.querySelectorAll("[data-command]").forEach((button) => {
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => {
        document.execCommand(button.dataset.command, false, null);
        $("editor")?.focus();
        updateCounter();
      });
    });
  }

  function updateCounter() {
    const editor = $("editor");
    const counter = $("counter");
    if (!editor || !counter) return;
    const count = (editor.innerText || "").length;
    counter.textContent = `${count} / ${MAX_CONTENT}`;
    counter.classList.toggle("limit-warning", count > MAX_CONTENT * 0.9);
  }

  function getSketchCanvas() { return $("sketch-canvas"); }

  function serializeSketch(canvas) {
    if (!canvas) return null;
    const hasInk = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value > 0);
    if (!hasInk) return null;
    return JSON.stringify({
      version: 1,
      width: canvas.clientWidth,
      height: canvas.clientHeight,
      dataUrl: canvas.toDataURL("image/png")
    });
  }

  function sketchHasPixels(canvas) {
    if (!canvas) return false;
    const ctx = canvas.getContext("2d");
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) return true;
    return false;
  }

  function setupSketch(initialData = null) {
    const editor = $("editor");
    const canvas = getSketchCanvas();
    if (!editor || !canvas) return { getData: () => null };

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const color = $("sketch-color");
    const size = $("sketch-size");
    const drawButton = $("sketch-toggle");
    const eraserButton = $("sketch-eraser");
    const clearButton = $("sketch-clear");
    const colorButtons = document.querySelectorAll("[data-sketch-color]");
    let drawing = false;
    let erasing = false;
    let lastX = 0;
    let lastY = 0;
    let restoring = false;

    function resizeCanvas(preserve = true) {
      const width = Math.max(1, editor.clientWidth);
      const height = Math.max(1, editor.scrollHeight, editor.clientHeight);
      const old = preserve && canvas.width && canvas.height ? canvas.toDataURL("image/png") : null;
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (old) {
        const image = new Image();
        image.onload = () => {
          ctx.drawImage(image, 0, 0, width, height);
        };
        image.src = old;
      }
    }

    function setMode(mode) {
      erasing = mode === "erase";
      const drawingMode = mode !== "off";
      canvas.classList.toggle("drawing", drawingMode);
      drawButton?.classList.toggle("active", mode === "draw");
      eraserButton?.classList.toggle("active", erasing);
      if (drawingMode) {
        editor.classList.add("sketch-active");
      } else {
        editor.classList.remove("sketch-active");
      }
    }

    function point(event) {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    function begin(event) {
      if (!canvas.classList.contains("drawing")) return;
      drawing = true;
      const p = point(event);
      lastX = p.x; lastY = p.y;
      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
      ctx.lineTo(lastX + 0.01, lastY + 0.01);
      ctx.strokeStyle = erasing ? "rgba(0,0,0,1)" : (color?.value || "#2d2924");
      ctx.lineWidth = Number(size?.value || 4);
      ctx.globalCompositeOperation = erasing ? "destination-out" : "source-over";
      ctx.stroke();
      event.preventDefault();
      canvas.setPointerCapture?.(event.pointerId);
    }

    function move(event) {
      if (!drawing) return;
      const p = point(event);
      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      lastX = p.x; lastY = p.y;
      event.preventDefault();
    }

    function end(event) {
      if (!drawing) return;
      drawing = false;
      canvas.releasePointerCapture?.(event.pointerId);
      event.preventDefault();
    }

    function clear() {
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    }

    drawButton?.addEventListener("click", () => setMode(drawButton.classList.contains("active") ? "off" : "draw"));
    eraserButton?.addEventListener("click", () => setMode(eraserButton.classList.contains("active") ? "off" : "erase"));
    clearButton?.addEventListener("click", () => { if (confirm("Clear the entire sketch?")) clear(); });
    colorButtons.forEach((button) => button.addEventListener("click", () => {
      if (color) color.value = button.dataset.sketchColor;
      colorButtons.forEach((b) => b.classList.toggle("active", b === button));
      if (eraserButton?.classList.contains("active")) setMode("draw");
    }));
    canvas.addEventListener("pointerdown", begin);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("pointerleave", (event) => { if (drawing && !canvas.hasPointerCapture?.(event.pointerId)) drawing = false; });

    resizeCanvas(false);

    if (initialData) {
      try {
        const saved = typeof initialData === "string" ? JSON.parse(initialData) : initialData;
        if (saved?.dataUrl) {
          restoring = true;
          const image = new Image();
          image.onload = () => {
            const width = canvas.clientWidth;
            const height = canvas.clientHeight;
            ctx.clearRect(0, 0, width, height);
            ctx.drawImage(image, 0, 0, width, height);
            restoring = false;
          };
          image.src = saved.dataUrl;
        }
      } catch (error) {
        console.warn("Could not restore sketch:", error);
      }
    }

    if (window.ResizeObserver) {
      const observer = new ResizeObserver(() => resizeCanvas(true));
      observer.observe(editor);
    } else {
      window.addEventListener("resize", () => resizeCanvas(true));
    }

    return {
      getData: () => {
        if (restoring || !sketchHasPixels(canvas)) return null;
        const data = serializeSketch(canvas);
        return data && data.length <= MAX_SKETCH_CHARS ? data : null;
      },
      clear
    };
  }

  async function setupWriter(edit = false) {
    await initAuth();
    setupDrawer();
    if (!currentUser) { location.href = "login.html"; return; }

    let topic = await getTopic(query("topic") || "general");
    if (!topic) { setText("write-status", "Topic not found."); return; }
    if (!topic.isGeneral && topic.owner_id !== currentUser.id) {
      setText("write-status", "Only the topic owner can add notes here.");
      return;
    }

    setText("writer-topic", topic.name);
    const back = $("writer-back");
    if (back) back.href = `topic.html?id=${encodeURIComponent(topic.isGeneral ? "general" : topic.id)}`;

    setupToolbar();
    updateCounter();

    const editor = $("editor");
    const title = $("title");
    let noteId = null;
    let sketchData = null;

    if (edit) {
      noteId = query("id");
      const r = await supabase.from("notes")
        .select("id,title,content,sketch_data,topic_id,author_id")
        .eq("id", noteId).maybeSingle();
      if (r.error || !r.data || r.data.author_id !== currentUser.id) {
        setText("write-status", "You cannot edit this note.");
        return;
      }
      topic = await getTopic(r.data.topic_id);
      if (!topic || topic.isGeneral || topic.owner_id !== currentUser.id) {
        setText("write-status", "GENERAL notes cannot be edited.");
        return;
      }
      setText("writer-topic", topic.name);
      title.value = r.data.title || "";
      editor.innerHTML = safeHtml(r.data.content || "");
      sketchData = r.data.sketch_data || null;
      updateCounter();
    }

    const sketch = setupSketch(sketchData);

    editor?.addEventListener("input", () => {
      if ((editor.innerText || "").length > MAX_CONTENT) {
        editor.innerText = (editor.innerText || "").slice(0, MAX_CONTENT);
        const selection = window.getSelection();
        if (selection) {
          selection.removeAllRanges();
          const range = document.createRange();
          range.selectNodeContents(editor);
          range.collapse(false);
          selection.addRange(range);
        }
      }
      updateCounter();
    });

    $("post-button")?.addEventListener("click", async () => {
      const cleanTitle = title.value.trim();
      const raw = editor.innerHTML.trim();
      const body = plain(raw);
      if (!cleanTitle || !body) { setText("write-status", "Title and note content are required."); return; }
      if (cleanTitle.length > MAX_TITLE || body.length > MAX_CONTENT) { setText("write-status", "Your note is too long."); return; }

      const clean = safeHtml(raw);
      const savedSketch = sketch.getData();
      if (savedSketch && savedSketch.length > MAX_SKETCH_CHARS) {
        setText("write-status", "Your sketch is too large. Make it simpler or smaller.");
        return;
      }

      $("post-button").disabled = true;
      setText("write-status", edit ? "Saving..." : "Posting...");

      let r;
      if (edit) {
        r = await supabase.from("notes").update({
          title: cleanTitle,
          content: clean,
          sketch_data: savedSketch,
          updated_at: new Date().toISOString()
        }).eq("id", noteId).select("id").single();
      } else {
        r = await supabase.from("notes").insert({
          topic_id: topic.isGeneral ? null : topic.id,
          author_id: currentUser.id,
          title: cleanTitle,
          content: clean,
          sketch_data: savedSketch
        }).select("id").single();
      }

      if (r.error) {
        setText("write-status", r.error.message);
        $("post-button").disabled = false;
        return;
      }
      location.href = `note.html?id=${encodeURIComponent(r.data.id)}`;
    });
  }

  async function loadSingleNote() {
    setupDrawer();
    await initAuth();
    await loadTopics();
    await loadProgress();

    const id = query("id");
    if (!id) { setText("note", "No note specified."); return; }

    const r = await supabase.from("notes")
      .select("id,topic_id,author_id,title,content,sketch_data,created_at,updated_at,profiles(username,display_name)")
      .eq("id", id).maybeSingle();
    if (r.error || !r.data) { setText("note", "This note could not be found."); return; }

    const topic = await getTopic(r.data.topic_id);
    if (!topic) { setText("note", "The note's topic could not be found."); return; }

    renderOwner(topic);
    const back = $("back-topic");
    if (back) back.href = `topic.html?id=${encodeURIComponent(topic.isGeneral ? "general" : topic.id)}`;

    const owner = topic.isGeneral ? "Anonymous" : (r.data.profiles?.display_name || r.data.profiles?.username || "User");
    const manage = !topic.isGeneral && currentUser && currentUser.id === r.data.author_id && currentUser.id === topic.owner_id;

    $("note").innerHTML = `
      <div class="note-meta">Posted: ${esc(date(r.data.created_at))}</div>
      <div class="note-author">${esc(owner)}</div>
      <h1>${esc(r.data.title)}</h1>
      <hr>
      <div class="note-content-stage">
        <div class="note-content">${safeHtml(r.data.content)}</div>
        ${r.data.sketch_data ? `<img class="saved-sketch" alt="" aria-hidden="true">` : ""}
      </div>
      <div class="note-bottom">
        ${manage ? `<a class="edit-link" href="edit-note.html?id=${encodeURIComponent(r.data.id)}">EDIT NOTE</a><button class="delete-link" id="single-delete">DELETE</button>` : `This note is read-only.`}
      </div>
    `;

    if (r.data.sketch_data) {
      try {
        const saved = JSON.parse(r.data.sketch_data);
        const image = $("note")?.querySelector(".saved-sketch");
        if (image && saved?.dataUrl) image.src = saved.dataUrl;
      } catch (error) {
        console.warn("Could not display sketch:", error);
      }
    }

    $("single-delete")?.addEventListener("click", async () => {
      if (!confirm("Delete this note permanently?")) return;
      const d = await supabase.from("notes").delete().eq("id", id);
      if (d.error) alert(d.error.message);
      else location.href = back?.href || "index.html";
    });
  }

  async function setupAuth(register) {
    if (register) setupDrawer();
    $("auth-submit")?.addEventListener("click", async () => {
      const email = $("email")?.value.trim();
      const password = $("password")?.value;
      const username = $("username")?.value.trim();
      if (!email || !password || (register && !username)) {
        setText("auth-status", "Please complete all fields.");
        return;
      }

      $("auth-submit").disabled = true;
      setText("auth-status", register ? "Creating account..." : "Logging in...");
      let r;

      if (register) {
        r = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { username },
            emailRedirectTo: new URL("index.html", location.href).href
          }
        });
      } else {
        r = await supabase.auth.signInWithPassword({ email, password });
      }

      if (r.error) {
        setText("auth-status", r.error.message);
        $("auth-submit").disabled = false;
        return;
      }

      if (register && !r.data.session) {
        setText("auth-status", "Account created. If Supabase email confirmation is enabled, you must confirm the email before logging in.");
        $("auth-submit").disabled = false;
        return;
      }

      location.href = "index.html";
    });
  }

  async function setupCreateTopic() {
    await initAuth();
    if (!currentUser) { location.href = "login.html"; return; }

    const c = await supabase.rpc("get_general_note_count", { p_user_id: currentUser.id });
    if (c.error || Number(c.data || 0) < 20) {
      setText("topic-status", "You need 20 GENERAL notes before creating a topic.");
      return;
    }

    $("create-topic-button")?.addEventListener("click", async () => {
      const name = $("topic-name").value.trim();
      const description = $("topic-description").value.trim();
      if (!name) { setText("topic-status", "Enter a topic name."); return; }
      $("create-topic-button").disabled = true;
      setText("topic-status", "Creating...");

      const r = await supabase.from("topics").insert({
        owner_id: currentUser.id,
        name,
        description
      }).select("id").single();

      if (r.error) {
        setText("topic-status", r.error.message);
        $("create-topic-button").disabled = false;
        return;
      }
      location.href = `topic.html?id=${encodeURIComponent(r.data.id)}`;
    });
  }

  async function setupAccount() {
    await initAuth();
    if (!currentUser) { location.href = "login.html"; return; }
    const profile = await getProfile(currentUser.id);
    setText("account-name", `@${profile?.username || "user"}`);
    setText("account-email", currentUser.email || "");

    const c = await supabase.rpc("get_general_note_count", { p_user_id: currentUser.id });
    const n = Number(c.data || 0);
    const progress = $("account-progress");
    if (progress) {
      progress.innerHTML = `<h3>TOPIC CREATION PROGRESS</h3><div class="progress-bar"><span style="width:${Math.min(100, n / 20 * 100)}%"></span></div><p>${n} / 20 GENERAL notes</p>${n >= 20 ? '<a class="action-button green" href="create-topic.html">CREATE TOPIC</a>' : `<p>Submit ${20 - n} more GENERAL notes to unlock.</p>`}`;
    }
    $("logout-button")?.addEventListener("click", async () => {
      await supabase.auth.signOut();
      location.href = "index.html";
    });
  }

  async function start() {
    if (page === "home" || page === "topic") await loadTopicPage();
    else if (page === "note") await loadSingleNote();
    else if (page === "write") await setupWriter(false);
    else if (page === "edit") await setupWriter(true);
    else if (page === "login") { await initAuth(); if (currentUser) location.href = "index.html"; else setupAuth(false); }
    else if (page === "register") { await initAuth(); if (currentUser) location.href = "index.html"; else setupAuth(true); }
    else if (page === "create-topic") await setupCreateTopic();
    else if (page === "account") await setupAccount();
  }

  start();
})();
