(() => {
  "use strict";

  const cfg = window.PUBLIC_NOTEBOOK_CONFIG || {};
  const page = document.body?.dataset?.page || "";
  const PAGE_SIZE = 10;
  const MAX_CONTENT = 20000;
  const MAX_TITLE = 120;
  const MAX_SKETCH = 4000000;

  const el = (id) => document.getElementById(id);
  const text = (id, value) => { const node = el(id); if (node) node.textContent = value ?? ""; };
  const query = (name) => new URLSearchParams(location.search).get(name);

  function esc(value) {
    const d = document.createElement("div");
    d.textContent = value == null ? "" : String(value);
    return d.innerHTML;
  }

  function plain(html) {
    const d = document.createElement("div");
    d.innerHTML = html || "";
    return (d.textContent || d.innerText || "").replace(/\s+/g, " ").trim();
  }

  function excerpt(html, n = 190) {
    const t = plain(html);
    return t.length > n ? t.slice(0, n).trim() + "…" : t;
  }

  function date(value) {
    try {
      return new Date(value).toLocaleString(undefined, {
        year: "numeric", month: "short", day: "2-digit",
        hour: "numeric", minute: "2-digit"
      });
    } catch { return ""; }
  }

  function safeHtml(html) {
    if (!window.DOMPurify) return esc(plain(html));
    return window.DOMPurify.sanitize(html || "", {
      ALLOWED_TAGS: ["b","strong","i","em","u","p","br","div","blockquote","ul","ol","li"],
      ALLOWED_ATTR: []
    });
  }

  function normalizeSketchData(value) {
    if (!value) return null;
    const raw = String(value).trim();
    if (!raw) return null;
    if (raw.startsWith("data:image/")) return raw;
    if (/^[A-Za-z0-9+/=\s]+$/.test(raw)) {
      return "data:image/png;base64," + raw.replace(/\s+/g, "");
    }
    return raw;
  }

  function configured() {
    return !!(cfg.supabaseUrl && cfg.supabaseKey &&
      !String(cfg.supabaseUrl).includes("PASTE_YOUR") &&
      !String(cfg.supabaseKey).includes("PASTE_YOUR"));
  }

  if (!configured()) {
    ["page-status","write-status","topic-status","auth-status"].forEach((id) => {
      text(id, "Supabase is not configured. Check config.js.");
    });
    return;
  }

  if (!window.supabase?.createClient) {
    text("auth-status", "Supabase could not be loaded. Check your internet connection.");
    return;
  }

  const supabase = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  let session = null;
  let currentUser = null;

  async function initAuth() {
    const { data, error } = await supabase.auth.getSession();
    if (error) console.error("getSession failed:", error);
    session = data?.session || null;
    currentUser = session?.user || null;
    renderAuth();
    return session;
  }

  function renderAuth() {
    const label = el("auth-label");
    const button = el("auth-button");
    const username = currentUser?.user_metadata?.username || currentUser?.email?.split("@")[0] || "user";
    if (label) label.textContent = currentUser ? `@${username}` : "";
    if (button) {
      button.textContent = currentUser ? "ACCOUNT" : "LOGIN";
      button.href = currentUser ? "account.html" : "login.html";
    }
    const community = el("community-button");
    if (community && currentUser) {
      community.textContent = "ACCOUNT";
      community.href = "account.html";
    }
  }

  supabase.auth.onAuthStateChange((_event, newSession) => {
    session = newSession || null;
    currentUser = session?.user || null;
    renderAuth();
  });

  async function getProfile(userId) {
    const { data, error } = await supabase.from("profiles")
      .select("id,username,display_name,bio,avatar_url,created_at")
      .eq("id", userId).maybeSingle();
    if (error) console.error("Profile lookup failed:", error);
    return data || null;
  }

  function setupDrawer() {
    const sidebar = el("topic-sidebar");
    const backdrop = el("drawer-backdrop");
    const open = () => { sidebar?.classList.add("open"); backdrop?.classList.add("open"); };
    const close = () => { sidebar?.classList.remove("open"); backdrop?.classList.remove("open"); };
    el("topics-toggle")?.addEventListener("click", open);
    el("topics-close")?.addEventListener("click", close);
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

  async function loadTopics(pageNo = Math.max(1, Number(query("topics_page") || 1))) {
    const list = el("topic-list");
    if (!list) return;
    const from = (pageNo - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error, count } = await supabase.from("topics")
      .select("id,name,description,owner_id,created_at,profiles(username,display_name)", { count: "exact" })
      .order("created_at", { ascending: false }).range(from, to);
    if (error) {
      console.error("Could not load topics:", error);
      list.innerHTML = `<div class="muted">${esc(error.message)}</div>`;
      return;
    }
    list.innerHTML = (data || []).map((topic) => `
      <a class="topic-link" href="topic.html?id=${encodeURIComponent(topic.id)}">
        <strong>${esc(topic.name)}</strong>
        <small>@${esc(topic.profiles?.username || "user")}</small>
      </a>`).join("") || `<div class="muted">No community topics yet.</div>`;
    renderPagination(el("topic-pagination"), pageNo, Math.max(1, Math.ceil((count || 0) / PAGE_SIZE)), (p) => {
      const url = new URL(location.href); url.searchParams.set("topics_page", p);
      history.pushState({}, "", url); loadTopics(p);
    });
  }

  async function loadProgress() {
    const box = el("progress-box");
    if (!box) return;
    if (!currentUser) {
      box.innerHTML = `<h3>TOPIC CREATION</h3><p>Login and submit notes to GENERAL to unlock your own topic.</p><a class="action-button blue" href="login.html">LOGIN</a>`;
      return;
    }
    const { data, error } = await supabase.rpc("get_general_note_count", { p_user_id: currentUser.id });
    if (error) {
      console.error("Could not load GENERAL progress:", error);
      box.innerHTML = `<p class="muted">Progress unavailable.</p>`;
      return;
    }
    const count = Number(data || 0);
    const percentage = Math.min(100, count / 20 * 100);
    box.innerHTML = `<h3>TOPIC CREATION</h3><div class="progress-bar"><span style="width:${percentage}%"></span></div>
      <p><strong>${count} / 20</strong> GENERAL notes</p>
      ${count >= 20 ? `<a class="action-button green" href="create-topic.html">CREATE TOPIC</a>` : `<p>Submit ${20-count} more to unlock.</p>`}`;
  }

  async function getTopic(topicId) {
    if (!topicId || topicId === "general") {
      return { id: "general", name: "GENERAL", description: "A public place for shared thoughts.", owner_id: null, isGeneral: true };
    }
    const { data, error } = await supabase.from("topics")
      .select("id,name,description,owner_id,created_at,profiles(id,username,display_name,bio,avatar_url)")
      .eq("id", topicId).maybeSingle();
    if (error || !data) { console.error("Could not load topic:", error); return null; }
    return { ...data, isGeneral: false };
  }

  async function loadNotes(topic, pageNo = Math.max(1, Number(query("page") || 1))) {
    const list = el("note-list");
    const status = el("page-status");
    if (!list) return;
    const from = (pageNo - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    let request = supabase.from("notes")
      .select("id,topic_id,author_id,title,content,sketch_data,created_at,updated_at,profiles(username,display_name)", { count: "exact" })
      .order("created_at", { ascending: false }).range(from, to);
    request = topic.isGeneral ? request.is("topic_id", null) : request.eq("topic_id", topic.id);
    const { data, error, count } = await request;
    if (error) {
      console.error("Could not load notes:", error);
      text("page-status", "Could not load notes: " + error.message);
      return;
    }
    if (status) status.textContent = (data || []).length ? "" : "No notes have been posted here yet.";
    list.innerHTML = (data || []).map((note) => {
      const owner = topic.isGeneral ? "Anonymous" : (note.profiles?.display_name || note.profiles?.username || "User");
      const manage = !topic.isGeneral && currentUser && note.author_id === currentUser.id && topic.owner_id === currentUser.id;
      return `<article class="note-card"><div class="note-main"><div class="note-author">${esc(owner)}</div><h2>${esc(note.title)}</h2><p>${esc(excerpt(note.content))}</p>${note.sketch_data ? `<div class="sketch-indicator">✎ Sketch attached</div>` : ""}</div>
        <div class="note-side"><div class="posted">Posted: ${esc(date(note.created_at))}</div><div class="note-actions"><a class="read-button" href="note.html?id=${encodeURIComponent(note.id)}">READ →</a>
        ${manage ? `<a class="edit-link" href="edit-note.html?id=${encodeURIComponent(note.id)}">EDIT</a><button class="delete-link" data-delete="${esc(note.id)}">DELETE</button>` : ""}</div></div></article>`;
    }).join("");
    list.querySelectorAll("[data-delete]").forEach((button) => button.addEventListener("click", () => deleteNote(button.dataset.delete, topic)));
    renderPagination(el("note-pagination"), pageNo, Math.max(1, Math.ceil((count || 0) / PAGE_SIZE)), (p) => {
      const url = new URL(location.href); url.searchParams.set("page", p); history.pushState({}, "", url); loadNotes(topic, p);
    });
  }

  async function deleteNote(id, topic) {
    if (!currentUser || topic.isGeneral) return;
    if (!confirm("Delete this note permanently?")) return;
    const { error } = await supabase.from("notes").delete().eq("id", id);
    if (error) { alert("Delete failed: " + error.message); return; }
    await loadNotes(topic, Number(query("page") || 1));
  }

  function renderOwner(topic) {
    const panel = el("owner-panel");
    if (!panel) return;
    if (topic.isGeneral) {
      panel.innerHTML = `<div class="owner-badge">★</div><h2>GENERAL</h2><p>Community-wide notes submitted by registered members.</p><p class="muted">Submitted notes are permanently read-only.</p>`;
      return;
    }
    const profile = topic.profiles || {};
    panel.innerHTML = `<div class="owner-avatar">${esc((profile.username || "U").slice(0,1).toUpperCase())}</div><h2>@${esc(profile.username || "user")}</h2><p>${esc(profile.bio || "This is my public notebook topic.")}</p>`;
  }

  async function loadTopicPage() {
    setupDrawer();
    await initAuth();
    await loadTopics();
    await loadProgress();
    const topic = await getTopic(query("id") || "general");
    if (!topic) { text("current-topic-name", "Topic not found"); text("page-status", "This topic does not exist."); return; }
    text("current-topic-name", topic.name);
    text("current-topic-description", topic.description || "");
    renderOwner(topic);
    const write = el("write-button");
    if (write) {
      const allowed = topic.isGeneral ? !!currentUser : !!currentUser && currentUser.id === topic.owner_id;
      write.style.display = allowed ? "inline-flex" : "none";
      write.href = topic.isGeneral ? "write.html?topic=general" : `write.html?topic=${encodeURIComponent(topic.id)}`;
    }
    await loadNotes(topic);
    document.querySelector(".general-link")?.classList.toggle("active", topic.isGeneral);
  }

  function setupToolbar() {
    document.querySelectorAll("[data-command]").forEach((button) => {
      button.addEventListener("mousedown", (e) => e.preventDefault());
      button.addEventListener("click", () => {
        document.execCommand(button.dataset.command, false, null);
        el("editor")?.focus(); updateCounter();
      });
    });
  }

  function updateCounter() {
    const editor = el("editor"); const counter = el("counter");
    if (!editor || !counter) return;
    const count = (editor.innerText || "").length;
    counter.textContent = `${count} / ${MAX_CONTENT}`;
    counter.classList.toggle("limit-warning", count > MAX_CONTENT * .9);
  }

  function setupSketch(initialData = null) {
    initialData = normalizeSketchData(initialData);
    const canvas = el("sketch-canvas");
    const stage = document.querySelector(".paper-stage");
    const editor = el("editor");
    if (!canvas || !stage || !editor) return { getData: () => null };

    const ctx = canvas.getContext("2d");
    let drawing = false;
    let erasing = false;
    let last = null;
    let color = el("sketch-color")?.value || "#2d2924";
    let size = Number(el("sketch-size")?.value || 4);

    function resize(preserve = true) {
      const old = preserve && canvas.width && canvas.height ? canvas.toDataURL("image/png") : null;
      const rect = stage.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      canvas.width = Math.round(w * ratio);
      canvas.height = Math.round(h * ratio);
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (old) {
        const img = new Image();
        img.onload = () => { ctx.setTransform(ratio,0,0,ratio,0,0); ctx.drawImage(img,0,0,w,h); };
        img.src = old;
      }
    }

    function load(data) {
      const normalized = normalizeSketchData(data);
      if (!normalized) return;
      const img = new Image();
      img.onload = () => {
        const rect = stage.getBoundingClientRect();
        const w = Math.max(1, Math.round(rect.width));
        const h = Math.max(1, Math.round(rect.height));
        const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
        ctx.setTransform(ratio,0,0,ratio,0,0);
        ctx.clearRect(0,0,w,h);
        ctx.drawImage(img,0,0,w,h);
      };
      img.onerror = () => console.error("The saved sketch could not be loaded in the editor.");
      img.src = normalized;
    }

    resize(false);
    load(initialData);
    window.addEventListener("resize", () => resize(true));

    const toggle = el("sketch-toggle");
    const eraser = el("sketch-eraser");
    const clear = el("sketch-clear");
    const colorInput = el("sketch-color");
    const sizeInput = el("sketch-size");

    const setMode = (erase) => {
      erasing = erase;
      canvas.classList.toggle("drawing", !!(toggle?.classList.contains("active") || eraser?.classList.contains("active")));
      editor.classList.toggle("sketch-active", canvas.classList.contains("drawing"));
      toggle?.classList.toggle("active", !erase && canvas.classList.contains("drawing"));
      eraser?.classList.toggle("active", erase && canvas.classList.contains("drawing"));
    };

    toggle?.addEventListener("click", () => {
      const active = canvas.classList.contains("drawing") && !erasing;
      if (active) { canvas.classList.remove("drawing"); editor.classList.remove("sketch-active"); toggle.classList.remove("active"); eraser?.classList.remove("active"); }
      else { canvas.classList.add("drawing"); editor.classList.add("sketch-active"); eraser?.classList.remove("active"); toggle.classList.add("active"); erasing = false; }
    });
    eraser?.addEventListener("click", () => {
      if (!canvas.classList.contains("drawing") || !erasing) { canvas.classList.add("drawing"); editor.classList.add("sketch-active"); erasing = true; eraser.classList.add("active"); toggle?.classList.remove("active"); }
      else { erasing = false; eraser.classList.remove("active"); toggle?.classList.add("active"); }
    });
    clear?.addEventListener("click", () => { const r=stage.getBoundingClientRect(); ctx.clearRect(0,0,r.width,r.height); });
    colorInput?.addEventListener("input", () => { color = colorInput.value; document.querySelectorAll(".swatch").forEach(s => s.classList.toggle("active", s.dataset.sketchColor === color)); });
    sizeInput?.addEventListener("change", () => { size = Number(sizeInput.value) || 4; });
    document.querySelectorAll(".swatch").forEach((swatch) => swatch.addEventListener("click", () => {
      color = swatch.dataset.sketchColor || color; if (colorInput) colorInput.value = color;
      document.querySelectorAll(".swatch").forEach(s => s.classList.remove("active")); swatch.classList.add("active");
    }));

    function point(e) { const r=canvas.getBoundingClientRect(); return {x:e.clientX-r.left,y:e.clientY-r.top}; }
    canvas.addEventListener("pointerdown", (e) => { if (!canvas.classList.contains("drawing")) return; e.preventDefault(); drawing=true; last=point(e); canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener("pointermove", (e) => {
      if (!drawing || !last) return; e.preventDefault(); const p=point(e);
      ctx.save(); ctx.lineCap="round"; ctx.lineJoin="round"; ctx.lineWidth=size;
      if (erasing) { ctx.globalCompositeOperation="destination-out"; ctx.strokeStyle="rgba(0,0,0,1)"; }
      else { ctx.globalCompositeOperation="source-over"; ctx.strokeStyle=color; }
      ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(p.x,p.y); ctx.stroke(); ctx.restore(); last=p;
    });
    const end = () => { drawing=false; last=null; };
    canvas.addEventListener("pointerup", end); canvas.addEventListener("pointercancel", end); canvas.addEventListener("pointerleave", () => { if (drawing) end(); });

    return {
      getData() {
        const rect=stage.getBoundingClientRect();
        const probe=document.createElement("canvas"); probe.width=Math.max(1,Math.round(rect.width)); probe.height=Math.max(1,Math.round(rect.height));
        const pctx=probe.getContext("2d"); pctx.drawImage(canvas,0,0,probe.width,probe.height);
        const pixels=pctx.getImageData(0,0,probe.width,probe.height).data;
        let nonEmpty=false; for(let i=3;i<pixels.length;i+=4){if(pixels[i]>0){nonEmpty=true;break;}}
        return nonEmpty ? probe.toDataURL("image/png") : null;
      }
    };
  }

  async function setupWriter(edit = false) {
    await initAuth(); setupDrawer();
    if (!currentUser) { location.href = "login.html"; return; }
    const topic = await getTopic(query("topic") || "general");
    if (!topic) { text("write-status", "Topic not found."); return; }
    if (!topic.isGeneral && topic.owner_id !== currentUser.id) { text("write-status", "Only the topic owner can add notes here."); return; }
    text("writer-topic", topic.name);
    const writerBack = el("writer-back");
    if (writerBack) writerBack.href = `topic.html?id=${encodeURIComponent(topic.isGeneral ? "general" : topic.id)}`;
    setupToolbar(); updateCounter();
    const editor=el("editor"), title=el("title"), postButton=el("post-button");
    if (!editor || !title || !postButton) return;
    let noteId=null, existingSketch=null;

    if (edit) {
      noteId=query("id"); if (!noteId) { text("write-status", "No note was specified."); return; }
      const {data,error}=await supabase.from("notes").select("id,title,content,topic_id,author_id,sketch_data").eq("id",noteId).maybeSingle();
      if(error || !data){ console.error(error); text("write-status","This note could not be found."); return; }
      if(data.author_id!==currentUser.id){ text("write-status","You cannot edit this note."); return; }
      const noteTopic=await getTopic(data.topic_id);
      if(!noteTopic){text("write-status","The note's topic could not be found.");return;}
      if(noteTopic.isGeneral){text("write-status","GENERAL notes cannot be edited.");return;}
      if(noteTopic.owner_id!==currentUser.id){text("write-status","Only the topic owner can edit notes.");return;}
      text("writer-topic",noteTopic.name); title.value=data.title||""; editor.innerHTML=safeHtml(data.content); existingSketch=data.sketch_data||null;
    }

    const sketch=setupSketch(existingSketch);
    editor.addEventListener("input", () => { const content=editor.innerText||""; if(content.length>MAX_CONTENT) editor.innerText=content.slice(0,MAX_CONTENT); updateCounter(); });

    postButton.addEventListener("click", async () => {
      const cleanTitle=title.value.trim(), raw=editor.innerHTML.trim(), body=plain(raw), sketchData=sketch.getData();
      if(!cleanTitle || !body){text("write-status","Title and note content are required.");return;}
      if(cleanTitle.length>MAX_TITLE || body.length>MAX_CONTENT){text("write-status","Your note is too long.");return;}
      if(sketchData && sketchData.length>MAX_SKETCH){text("write-status","The sketch is too large. Please simplify it.");return;}
      postButton.disabled=true; text("write-status",edit?"Saving...":"Posting...");
      let result;
      if(edit){
        result=await supabase.from("notes").update({title:cleanTitle,content:safeHtml(raw),sketch_data:sketchData,updated_at:new Date().toISOString()}).eq("id",noteId).select("id").single();
      }else{
        result=await supabase.from("notes").insert({topic_id:topic.isGeneral?null:topic.id,author_id:currentUser.id,title:cleanTitle,content:safeHtml(raw),sketch_data:sketchData}).select("id").single();
      }
      if(result.error){console.error("Note save failed:",result.error);text("write-status",result.error.message);postButton.disabled=false;return;}
      location.href=`note.html?id=${encodeURIComponent(result.data.id)}`;
    });
  }

  async function loadSingleNote() {
    setupDrawer(); await initAuth(); await loadTopics();
    const noteId=query("id"), container=el("note");
    if(!container){return;}
    if(!noteId){container.innerHTML=`<div class="status">No note was specified.</div>`;return;}
    const {data,error}=await supabase.from("notes").select("id,topic_id,author_id,title,content,sketch_data,created_at,updated_at,profiles(username,display_name)").eq("id",noteId).maybeSingle();
    if(error||!data){console.error(error);container.innerHTML=`<div class="status">This note could not be found.</div>`;return;}
    const topic=await getTopic(data.topic_id);
    if(!topic){container.innerHTML=`<div class="status">The note's topic could not be found.</div>`;return;}
    renderOwner(topic); await loadProgress();
    text("current-topic-name",topic.name);
    const back=el("back-topic"); if(back) back.href=`topic.html?id=${encodeURIComponent(topic.isGeneral?"general":topic.id)}`;
    const owner=topic.isGeneral?"Anonymous":(data.profiles?.display_name||data.profiles?.username||"User");
    const canManage=!topic.isGeneral&&currentUser&&data.author_id===currentUser.id&&topic.owner_id===currentUser.id;
    const sketchData = normalizeSketchData(data.sketch_data);
    container.innerHTML=`<div class="full-note-paper"><div class="note-author">${esc(owner)}</div><h1>${esc(data.title)}</h1><div class="full-note-meta">Posted ${esc(date(data.created_at))}${data.updated_at&&data.updated_at!==data.created_at?` · Updated ${esc(date(data.updated_at))}`:""}</div>
      <div class="note-content-stage"><div class="note-content">${safeHtml(data.content)}</div>${sketchData?`<img class="saved-sketch" alt="Attached sketch" decoding="async">`:""}</div>
      ${canManage?`<div class="full-note-actions"><a class="action-button green" href="edit-note.html?id=${encodeURIComponent(data.id)}">EDIT NOTE</a></div>`:""}</div>`;
    if (sketchData) {
      const sketchImage = container.querySelector(".saved-sketch");
      if (sketchImage) {
        sketchImage.addEventListener("error", () => { sketchImage.remove(); console.error("The saved sketch could not be decoded."); }, { once:true });
        sketchImage.src = sketchData;
      }
    }
  }

  async function setupCreateTopic() {
    await initAuth(); if(!currentUser){location.href="login.html";return;}
    const {data,error}=await supabase.rpc("get_general_note_count",{p_user_id:currentUser.id});
    if(error||Number(data||0)<20){text("topic-status","You need 20 GENERAL notes before creating a topic.");return;}
    el("create-topic-button")?.addEventListener("click",async()=>{
      const name=el("topic-name")?.value.trim()||"", description=el("topic-description")?.value.trim()||"", button=el("create-topic-button");
      if(!name){text("topic-status","Enter a topic name.");return;} if(name.length>80){text("topic-status","Topic name must be 80 characters or fewer.");return;} if(description.length>300){text("topic-status","Description must be 300 characters or fewer.");return;}
      button.disabled=true;text("topic-status","Creating...");
      const r=await supabase.from("topics").insert({name,description,owner_id:currentUser.id}).select("id").single();
      if(r.error){console.error(r.error);text("topic-status","Could not create topic: "+r.error.message);button.disabled=false;return;}
      location.href=`topic.html?id=${encodeURIComponent(r.data.id)}`;
    });
  }

  async function setupAccount() {
    await initAuth(); if(!currentUser){location.href="login.html";return;}
    const profile=await getProfile(currentUser.id);
    text("account-name","@"+(profile?.username||currentUser.user_metadata?.username||currentUser.email?.split("@")[0]||"user"));
    text("account-email",currentUser.email||"");
    const {data,error}=await supabase.rpc("get_general_note_count",{p_user_id:currentUser.id});
    const count=error?0:Number(data||0), progress=el("account-progress");
    if(progress){const pct=Math.min(100,count/20*100);progress.innerHTML=`<h3>TOPIC CREATION PROGRESS</h3><div class="progress-bar"><span style="width:${pct}%"></span></div><p><strong>${count} / 20</strong> GENERAL notes</p>${count>=20?`<a class="action-button green" href="create-topic.html">CREATE TOPIC</a>`:`<p>Submit ${20-count} more GENERAL notes to unlock.</p>`}`;}
    el("logout-button")?.addEventListener("click",async()=>{await supabase.auth.signOut();location.href="index.html";});
  }

  function authErrorMessage(error) {
    const msg=String(error?.message||"Login failed.");
    if(/email.*not.*confirm|email.*confirm/i.test(msg)) return "This account is still marked as unconfirmed by Supabase. Disable Confirm email in Supabase Authentication settings, then existing users can be confirmed with the supplied SQL fix.";
    if(/invalid login credentials/i.test(msg)) return "Incorrect email or password.";
    if(/user.*not.*found/i.test(msg)) return "No account was found for this email.";
    return msg;
  }

  async function setupAuth(register) {
    const submit=el("auth-submit"); if(!submit)return;
    submit.addEventListener("click",async()=>{
      const email=el("email")?.value.trim()||"", password=el("password")?.value||"", username=el("username")?.value.trim()||"";
      if(!email||!password||(register&&!username)){text("auth-status","Please complete all fields.");return;}
      if(register&&(username.length<3||username.length>30)){text("auth-status","Username must be 3–30 characters.");return;}
      submit.disabled=true;text("auth-status",register?"Creating account...":"Logging in...");
      let result;
      if(register){
        const redirectUrl=`${location.origin}${location.pathname.replace(/register\.html$/i,"")}`;
        result=await supabase.auth.signUp({email,password,options:{data:{username},emailRedirectTo:redirectUrl}});
      }else{result=await supabase.auth.signInWithPassword({email,password});}
      if(result.error){console.error(result.error);text("auth-status",authErrorMessage(result.error));submit.disabled=false;return;}
      session=result.data?.session||null;currentUser=session?.user||null;renderAuth();
      if(register&&!session){text("auth-status","Account created, but Supabase is requiring email confirmation. Turn off Confirm email in Authentication settings if accounts should work immediately.");submit.disabled=false;return;}
      location.href="index.html";
    });
    el("password")?.addEventListener("keydown",e=>{if(e.key==="Enter")submit.click();});
  }

  async function start() {
    try {
      if(page==="home"||page==="topic") await loadTopicPage();
      else if(page==="note") await loadSingleNote();
      else if(page==="write") await setupWriter(false);
      else if(page==="edit") await setupWriter(true);
      else if(page==="login"){await initAuth();if(currentUser)location.href="index.html";else setupAuth(false);}
      else if(page==="register"){await initAuth();if(currentUser)location.href="index.html";else setupAuth(true);}
      else if(page==="create-topic") await setupCreateTopic();
      else if(page==="account") await setupAccount();
    } catch(error) {
      console.error("Application initialization error:",error);
      text("page-status","The website encountered an error while loading.");
      text("auth-status","The website encountered an error while loading. Check the browser console for details.");
    }
  }

  start();
})();
