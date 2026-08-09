(() => {
  const cfg = window.PUBLIC_NOTEBOOK_CONFIG || {};
  const page = document.body.dataset.page;

  const PAGE_SIZE = 10;
  const MAX_CONTENT = 20000;
  const MAX_TITLE = 120;

  function el(id) {
    return document.getElementById(id);
  }

  function text(id, value) {
    if (el(id)) {
      el(id).textContent = value;
    }
  }

  function esc(value) {
    const d = document.createElement("div");
    d.textContent = value == null ? "" : String(value);
    return d.innerHTML;
  }

  function plain(html) {
    const d = document.createElement("div");
    d.innerHTML = html || "";

    return (d.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function excerpt(html, n = 190) {
    const t = plain(html);

    return t.length > n
      ? t.slice(0, n).trim() + "…"
      : t;
  }

  function date(v) {
    return new Date(v).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "numeric",
      minute: "2-digit"
    });
  }

  function query(name) {
    return new URLSearchParams(location.search).get(name);
  }

  function safeHtml(html) {
    if (!window.DOMPurify) {
      return esc(plain(html));
    }

    return DOMPurify.sanitize(html || "", {
      ALLOWED_TAGS: [
        "b",
        "strong",
        "i",
        "em",
        "u",
        "p",
        "br",
        "div",
        "blockquote",
        "ul",
        "ol",
        "li"
      ],
      ALLOWED_ATTR: []
    });
  }

  function configured() {
    return (
      cfg.supabaseUrl &&
      cfg.supabaseKey &&
      !cfg.supabaseUrl.includes("PASTE_YOUR") &&
      !cfg.supabaseKey.includes("PASTE_YOUR")
    );
  }

  if (!configured()) {
    [
      "page-status",
      "write-status",
      "topic-status",
      "auth-status"
    ].forEach((id) => {
      text(
        id,
        "Supabase is not configured. Copy config.example.js to config.js and add your browser-safe Supabase values."
      );
    });

    return;
  }

  const supabase = window.supabase.createClient(
    cfg.supabaseUrl,
    cfg.supabaseKey
  );

  let session = null;
  let currentUser = null;


  /* =========================================================
     AUTHENTICATION
  ========================================================= */

  async function initAuth() {
    const result = await supabase.auth.getSession();

    session = result.data.session;
    currentUser = session ? session.user : null;

    renderAuth();
  }

  function renderAuth() {
    const label = el("auth-label");
    const button = el("auth-button");

    if (label) {
      label.textContent = currentUser
        ? "@" +
          (
            currentUser.user_metadata?.username ||
            currentUser.email?.split("@")[0] ||
            "user"
          )
        : "";
    }

    if (button) {
      button.textContent = currentUser
        ? "ACCOUNT"
        : "LOGIN";

      button.href = currentUser
        ? "account.html"
        : "login.html";
    }

    const community = el("community-button");

    if (community && currentUser) {
      community.textContent = "ACCOUNT";
      community.href = "account.html";
    }
  }


  /* =========================================================
     PROFILE
  ========================================================= */

  async function getProfile(userId) {
    const r = await supabase
      .from("profiles")
      .select(
        "id,username,display_name,bio,avatar_url,created_at"
      )
      .eq("id", userId)
      .maybeSingle();

    return r.data;
  }


  /* =========================================================
     TOPIC DRAWER
  ========================================================= */

  function setupDrawer() {
    const sidebar = el("topic-sidebar");
    const backdrop = el("drawer-backdrop");

    el("topics-toggle")?.addEventListener("click", () => {
      sidebar?.classList.add("open");
      backdrop?.classList.add("open");
    });

    el("topics-close")?.addEventListener("click", close);

    backdrop?.addEventListener("click", close);

    function close() {
      sidebar?.classList.remove("open");
      backdrop?.classList.remove("open");
    }
  }


  /* =========================================================
     LOAD TOPICS
  ========================================================= */

  async function loadTopics(
    pageNo = Number(query("topics_page") || 1)
  ) {
    const list = el("topic-list");

    if (!list) {
      return;
    }

    const from = (pageNo - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const r = await supabase
      .from("topics")
      .select(
        "id,name,description,owner_id,created_at,profiles(username,display_name)",
        { count: "exact" }
      )
      .neq(
        "id",
        "00000000-0000-0000-0000-000000000000"
      )
      .order("created_at", {
        ascending: false
      })
      .range(from, to);

    if (r.error) {
      list.innerHTML =
        `<div class="muted">${esc(r.error.message)}</div>`;

      return;
    }

    list.innerHTML = r.data
      .map(
        (t) => `
          <a
            class="topic-link"
            href="topic.html?id=${encodeURIComponent(t.id)}"
          >
            <strong>${esc(t.name)}</strong>
            <small>
              @${esc(t.profiles?.username || "user")}
            </small>
          </a>
        `
      )
      .join("")
      ||
      `
        <div class="muted">
          No community topics yet.
        </div>
      `;

    renderPagination(
      el("topic-pagination"),
      pageNo,
      Math.max(
        1,
        Math.ceil((r.count || 0) / PAGE_SIZE)
      ),
      (p) => loadTopics(p)
    );
  }


  /* =========================================================
     PAGINATION
  ========================================================= */

  function renderPagination(
    container,
    current,
    total,
    callback
  ) {
    if (!container) {
      return;
    }

    if (total <= 1) {
      container.innerHTML = "";
      return;
    }

    let html = `
      <button
        ${current <= 1 ? "disabled" : ""}
        data-p="${current - 1}"
      >
        ←
      </button>
    `;

    for (
      let p = Math.max(1, current - 2);
      p <= Math.min(total, current + 2);
      p++
    ) {
      html += `
        <button
          class="${p === current ? "active" : ""}"
          data-p="${p}"
        >
          ${p}
        </button>
      `;
    }

    html += `
      <button
        ${current >= total ? "disabled" : ""}
        data-p="${current + 1}"
      >
        →
      </button>
    `;

    container.innerHTML = html;

    container
      .querySelectorAll("button:not(:disabled)")
      .forEach((b) => {
        b.addEventListener("click", () => {
          callback(Number(b.dataset.p));
        });
      });
  }


  /* =========================================================
     GENERAL TOPIC PROGRESS
  ========================================================= */

  async function loadProgress() {
    const box = el("progress-box");

    if (!box) {
      return;
    }

    if (!currentUser) {
      box.innerHTML = `
        <h3>TOPIC CREATION</h3>

        <p>
          Login and submit notes to GENERAL
          to unlock your own topic.
        </p>

        <a
          class="action-button blue"
          href="login.html"
        >
          LOGIN
        </a>
      `;

      return;
    }

    const r = await supabase.rpc(
      "get_general_note_count",
      {
        p_user_id: currentUser.id
      }
    );

    if (r.error) {
      box.innerHTML = `
        <p class="muted">
          Progress unavailable.
        </p>
      `;

      return;
    }

    const count = Number(r.data || 0);

    const pct = Math.min(
      100,
      (count / 20) * 100
    );

    box.innerHTML = `
      <h3>TOPIC CREATION</h3>

      <div class="progress-bar">
        <span style="width:${pct}%"></span>
      </div>

      <p>
        <strong>${count} / 20</strong>
        GENERAL notes
      </p>

      ${
        count >= 20
          ? `
            <a
              class="action-button green"
              href="create-topic.html"
            >
              CREATE TOPIC
            </a>
          `
          : `
            <p>
              Submit ${20 - count} more to unlock.
            </p>
          `
      }
    `;
  }


  /* =========================================================
     GET TOPIC
  ========================================================= */

  async function getTopic(topicId) {
    if (
      topicId === "general" ||
      !topicId
    ) {
      return {
        id: "general",
        name: "GENERAL",
        description:
          "A public place for shared thoughts.",
        owner_id: null,
        isGeneral: true
      };
    }

    const r = await supabase
      .from("topics")
      .select(
        "id,name,description,owner_id,created_at,profiles(id,username,display_name,bio,avatar_url)"
      )
      .eq("id", topicId)
      .maybeSingle();

    if (r.error || !r.data) {
      return null;
    }

    return {
      ...r.data,
      isGeneral: false
    };
  }


  /* =========================================================
     LOAD NOTES
  ========================================================= */

  async function loadNotes(
    topic,
    pageNo = Number(query("page") || 1)
  ) {
    const list = el("note-list");
    const status = el("page-status");

    if (!list) {
      return;
    }

    const topicFilter = topic.isGeneral
      ? "00000000-0000-0000-0000-000000000001"
      : topic.id;

    const from = (pageNo - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const r = await supabase
      .from("notes")
      .select(
        "id,topic_id,author_id,title,content,created_at,updated_at,profiles(username,display_name)",
        {
          count: "exact"
        }
      )
      .eq("topic_id", topicFilter)
      .order("created_at", {
        ascending: false
      })
      .range(from, to);

    if (r.error) {
      text(
        "page-status",
        "Could not load notes: " +
          r.error.message
      );

      return;
    }

    status.textContent = r.data.length
      ? ""
      : "No notes have been posted here yet.";

    list.innerHTML = r.data
      .map((n) => {
        const owner = topic.isGeneral
          ? "Anonymous"
          : (
              n.profiles?.display_name ||
              n.profiles?.username ||
              "User"
            );

        const manage =
          !topic.isGeneral &&
          currentUser &&
          n.author_id === currentUser.id &&
          topic.owner_id === currentUser.id;

        return `
          <article class="note-card">

            <div class="note-main">

              <div class="note-author">
                ${esc(owner)}
              </div>

              <h2>
                ${esc(n.title)}
              </h2>

              <p>
                ${esc(excerpt(n.content))}
              </p>

            </div>

            <div class="note-side">

              <div class="posted">
                Posted:
                ${esc(date(n.created_at))}
              </div>

              <div class="note-actions">

                <a
                  class="read-button"
                  href="note.html?id=${encodeURIComponent(n.id)}"
                >
                  READ →
                </a>

                ${
                  manage
                    ? `
                      <a
                        class="edit-link"
                        href="edit-note.html?id=${encodeURIComponent(n.id)}"
                      >
                        EDIT
                      </a>

                      <button
                        class="delete-link"
                        data-delete="${esc(n.id)}"
                      >
                        DELETE
                      </button>
                    `
                    : ""
                }

              </div>

            </div>

          </article>
        `;
      })
      .join("");

    list
      .querySelectorAll("[data-delete]")
      .forEach((b) => {
        b.addEventListener(
          "click",
          () =>
            deleteNote(
              b.dataset.delete,
              topic
            )
        );
      });

    renderPagination(
      el("note-pagination"),
      pageNo,
      Math.max(
        1,
        Math.ceil(
          (r.count || 0) / PAGE_SIZE
        )
      ),
      (p) => {
        const u = new URL(location.href);

        u.searchParams.set(
          "page",
          p
        );

        history.pushState(
          {},
          "",
          u
        );

        loadNotes(topic, p);
      }
    );
  }


  /* =========================================================
     DELETE NOTE
  ========================================================= */

  async function deleteNote(id, topic) {
    if (
      !currentUser ||
      topic.isGeneral ||
      !confirm(
        "Delete this note permanently?"
      )
    ) {
      return;
    }

    const r = await supabase
      .from("notes")
      .delete()
      .eq("id", id);

    if (r.error) {
      alert(
        "Delete failed: " +
          r.error.message
      );
    } else {
      loadNotes(
        topic,
        Number(query("page") || 1)
      );
    }
  }


  /* =========================================================
     TOPIC OWNER PANEL
  ========================================================= */

  function renderOwner(topic) {
    const panel = el("owner-panel");

    if (!panel) {
      return;
    }

    if (topic.isGeneral) {
      panel.innerHTML = `
        <div class="owner-badge">
          ★
        </div>

        <h2>GENERAL</h2>

        <p>
          Community-wide notes submitted
          by registered members.
        </p>

        <p class="muted">
          Submitted notes are permanently
          read-only.
        </p>
      `;

      return;
    }

    const p = topic.profiles || {};

    panel.innerHTML = `
      <div class="owner-avatar">
        ${esc(
          (p.username || "U")
            .slice(0, 1)
            .toUpperCase()
        )}
      </div>

      <h2>
        @${esc(p.username || "user")}
      </h2>

      <p>
        ${esc(
          p.bio ||
            "This is my public notebook topic."
        )}
      </p>
    `;
  }


  /* =========================================================
     TOPIC PAGE
  ========================================================= */

  async function loadTopicPage() {
    setupDrawer();

    await initAuth();
    await loadTopics();
    await loadProgress();

    const topic = await getTopic(
      query("id") || "general"
    );

    if (!topic) {
      text(
        "current-topic-name",
        "Topic not found"
      );

      text(
        "page-status",
        "This topic does not exist."
      );

      return;
    }

    text(
      "current-topic-name",
      topic.name
    );

    text(
      "current-topic-description",
      topic.description || ""
    );

    renderOwner(topic);

    const write = el("write-button");

    if (write) {
      const allowed = topic.isGeneral
        ? !!currentUser
        : !!currentUser &&
          currentUser.id === topic.owner_id;

      write.style.display = allowed
        ? "inline-flex"
        : "none";

      write.href = topic.isGeneral
        ? "write.html?topic=general"
        : `write.html?topic=${encodeURIComponent(
            topic.id
          )}`;
    }

    await loadNotes(topic);

    const gen =
      document.querySelector(
        ".general-link"
      );

    if (gen && topic.isGeneral) {
      gen.classList.add("active");
    }
  }


  /* =========================================================
     EDITOR TOOLBAR
  ========================================================= */

  function setupToolbar() {
    document
      .querySelectorAll("[data-command]")
      .forEach((b) => {
        b.addEventListener(
          "mousedown",
          (e) => e.preventDefault()
        );
      });

    document
      .querySelectorAll("[data-command]")
      .forEach((b) => {
        b.addEventListener(
          "click",
          () => {
            document.execCommand(
              b.dataset.command,
              false,
              null
            );

            el("editor")?.focus();

            updateCounter();
          }
        );
      });
  }


  /* =========================================================
     EDITOR COUNTER
  ========================================================= */

  function updateCounter() {
    const e = el("editor");
    const c = el("counter");

    if (e && c) {
      const n =
        (e.innerText || "").length;

      c.textContent =
        `${n} / ${MAX_CONTENT}`;

      c.classList.toggle(
        "limit-warning",
        n > MAX_CONTENT * 0.9
      );
    }
  }


  /* =========================================================
     WRITE / EDIT NOTE
  ========================================================= */

  async function setupWriter(edit = false) {
    await initAuth();

    setupDrawer();

    if (!currentUser) {
      location.href = "login.html";
      return;
    }

    const topic = await getTopic(
      query("topic") || "general"
    );

    if (!topic) {
      text(
        "write-status",
        "Topic not found."
      );

      return;
    }

    if (
      !topic.isGeneral &&
      topic.owner_id !== currentUser.id
    ) {
      text(
        "write-status",
        "Only the topic owner can add notes here."
      );

      return;
    }

    text(
      "writer-topic",
      topic.name
    );

    el("writer-back").href =
      `topic.html?id=${encodeURIComponent(
        topic.isGeneral
          ? "general"
          : topic.id
      )}`;

    setupToolbar();
    updateCounter();

    const editor = el("editor");
    const title = el("title");

    editor?.addEventListener(
      "input",
      () => {
        if (
          (editor.innerText || "").length >
          MAX_CONTENT
        ) {
          editor.innerText =
            (editor.innerText || "")
              .slice(
                0,
                MAX_CONTENT
              );
        }

        updateCounter();
      }
    );

    let noteId = null;

    if (edit) {
      noteId = query("id");

      const r = await supabase
        .from("notes")
        .select(
          "id,title,content,topic_id,author_id"
        )
        .eq("id", noteId)
        .maybeSingle();

      if (
        r.error ||
        !r.data ||
        r.data.author_id !==
          currentUser.id
      ) {
        text(
          "write-status",
          "You cannot edit this note."
        );

        return;
      }

      const t = await getTopic(
        r.data.topic_id
      );

      if (
        !t ||
        t.isGeneral ||
        t.owner_id !== currentUser.id
      ) {
        text(
          "write-status",
          "GENERAL notes cannot be edited."
        );

        return;
      }

      text(
        "writer-topic",
        t.name
      );

      title.value =
        r.data.title;

      editor.innerHTML =
        safeHtml(r.data.content);
    }

    el("post-button").addEventListener(
      "click",
      async () => {
        const cleanTitle =
          title.value.trim();

        const raw =
          editor.innerHTML.trim();

        const body = plain(raw);

        if (!cleanTitle || !body) {
          text(
            "write-status",
            "Title and note content are required."
          );

          return;
        }

        if (
          cleanTitle.length >
            MAX_TITLE ||
          body.length >
            MAX_CONTENT
        ) {
          text(
            "write-status",
            "Your note is too long."
          );

          return;
        }

        const clean =
          safeHtml(raw);

        el("post-button").disabled =
          true;

        text(
          "write-status",
          edit
            ? "Saving..."
            : "Posting..."
        );

        let r;

        if (edit) {
          r = await supabase
            .from("notes")
            .update({
              title: cleanTitle,
              content: clean,
              updated_at:
                new Date().toISOString()
            })
            .eq("id", noteId)
            .select("id")
            .single();
        } else {
          r = await supabase
            .from("notes")
            .insert({
              topic_id:
                topic.isGeneral
                  ? null
                  : topic.id,
              title: cleanTitle,
              content: clean
            })
            .select("id")
            .single();
        }

        if (r.error) {
          text(
            "write-status",
            r.error.message
          );

          el("post-button").disabled =
            false;

          return;
        }

        location.href =
          `note.html?id=${encodeURIComponent(
            r.data.id
          )}`;
      }
    );
  }


  /* =========================================================
     SINGLE NOTE PAGE
  ========================================================= */

  async function loadSingleNote() {
    setupDrawer();

    await initAuth();
    await loadTopics();
    await loadProgress();

    const id = query("id");

    if (!id) {
      text(
        "note",
        "No note specified."
      );

      return;
    }

    const r = await supabase
      .from("notes")
      .select(
        "id,topic_id,author_id,title,content,created_at,updated_at,profiles(username,display_name)"
      )
      .eq("id", id)
      .maybeSingle();

    if (r.error || !r.data) {
      text(
        "note",
        "This note could not be found."
      );

      return;
    }

    const topic = await getTopic(
      r.data.topic_id
    );

    if (!topic) {
      text(
        "note",
        "The note's topic could not be found."
      );

      return;
    }

    text("owner-panel", "");

    renderOwner(topic);

    el("back-topic").href =
      `topic.html?id=${encodeURIComponent(
        topic.isGeneral
          ? "general"
          : topic.id
      )}`;

    const owner = topic.isGeneral
      ? "Anonymous"
      : (
          r.data.profiles?.display_name ||
          r.data.profiles?.username ||
          "User"
        );

    const manage =
      !topic.isGeneral &&
      currentUser &&
      currentUser.id ===
        r.data.author_id &&
      currentUser.id ===
        topic.owner_id;

    el("note").innerHTML = `
      <div class="note-meta">
        Posted:
        ${esc(date(r.data.created_at))}
      </div>

      <div class="note-author">
        ${esc(owner)}
      </div>

      <h1>
        ${esc(r.data.title)}
      </h1>

      <hr>

      <div class="note-content">
        ${safeHtml(r.data.content)}
      </div>

      <div class="note-bottom">
        ${
          manage
            ? `
              <a
                class="edit-link"
                href="edit-note.html?id=${encodeURIComponent(
                  r.data.id
                )}"
              >
                EDIT NOTE
              </a>

              <button
                class="delete-link"
                id="single-delete"
              >
                DELETE
              </button>
            `
            : `
              This note is read-only.
            `
        }
      </div>
    `;

    el("single-delete")?.addEventListener(
      "click",
      async () => {
        if (
          confirm(
            "Delete this note permanently?"
          )
        ) {
          const d =
            await supabase
              .from("notes")
              .delete()
              .eq("id", id);

          if (d.error) {
            alert(d.error.message);
          } else {
            location.href =
              el("back-topic").href;
          }
        }
      }
    );
  }


  /* =========================================================
     LOGIN / REGISTRATION
  ========================================================= */

  async function setupAuth(register) {
    if (register) {
      setupDrawer();
    }

    el("auth-submit")?.addEventListener(
      "click",
      async () => {
        const email =
          el("email")?.value.trim();

        const password =
          el("password")?.value;

        const username =
          el("username")?.value.trim();

        if (
          !email ||
          !password ||
          (register && !username)
        ) {
          text(
            "auth-status",
            "Please complete all fields."
          );

          return;
        }

        el("auth-submit").disabled =
          true;

        text(
          "auth-status",
          register
            ? "Creating account..."
            : "Logging in..."
        );

        let r;

        /* =====================================================
           REGISTRATION

           IMPORTANT:
           This URL is your GitHub Pages website,
           NOT the GitHub repository URL.
        ===================================================== */

        if (register) {
          r = await supabase.auth.signUp({
            email: email,
            password: password,

            options: {
              emailRedirectTo:
                "https://hzeru24.github.io/public-notebook/index.html",

              data: {
                username: username
              }
            }
          });
        }

        /* =====================================================
           LOGIN
        ===================================================== */

        else {
          r =
            await supabase.auth.signInWithPassword({
              email: email,
              password: password
            });
        }

        /* =====================================================
           ERROR
        ===================================================== */

        if (r.error) {
          text(
            "auth-status",
            r.error.message
          );

          el("auth-submit").disabled =
            false;

          return;
        }

        /* =====================================================
           EMAIL VERIFICATION REQUIRED
        ===================================================== */

        if (
          register &&
          !r.data.session
        ) {
          text(
            "auth-status",
            "Account created. Check your email to verify your account, then log in."
          );

          el("auth-submit").disabled =
            false;

          return;
        }

        /* =====================================================
           SUCCESSFUL LOGIN / SIGNUP
        ===================================================== */

        location.href =
          "index.html";
      }
    );
  }


  /* =========================================================
     CREATE TOPIC
  ========================================================= */

  async function setupCreateTopic() {
    await initAuth();

    if (!currentUser) {
      location.href =
        "login.html";

      return;
    }

    const c =
      await supabase.rpc(
        "get_general_note_count",
        {
          p_user_id:
            currentUser.id
        }
      );

    if (
      c.error ||
      Number(c.data || 0) < 20
    ) {
      text(
        "topic-status",
        "You need 20 GENERAL notes before creating a topic."
      );

      return;
    }

    el("create-topic-button").addEventListener(
      "click",
      async () => {
        const name =
          el("topic-name")
            .value
            .trim();

        const description =
          el("topic-description")
            .value
            .trim();

        if (!name) {
          text(
            "topic-status",
            "Enter a topic name."
          );

          return;
        }

        el(
          "create-topic-button"
        ).disabled = true;

        text(
          "topic-status",
          "Creating..."
        );

        const r =
          await supabase
            .from("topics")
            .insert({
              name,
              description
            })
            .select("id")
            .single();

        if (r.error) {
          text(
            "topic-status",
            r.error.message
          );

          el(
            "create-topic-button"
          ).disabled = false;

          return;
        }

        location.href =
          `topic.html?id=${encodeURIComponent(
            r.data.id
          )}`;
      }
    );
  }


  /* =========================================================
     ACCOUNT PAGE
  ========================================================= */

  async function setupAccount() {
    await initAuth();

    if (!currentUser) {
      location.href =
        "login.html";

      return;
    }

    const p =
      await getProfile(
        currentUser.id
      );

    text(
      "account-name",
      "@" +
        (p?.username || "user")
    );

    text(
      "account-email",
      currentUser.email || ""
    );

    const c =
      await supabase.rpc(
        "get_general_note_count",
        {
          p_user_id:
            currentUser.id
        }
      );

    const n =
      Number(c.data || 0);

    el(
      "account-progress"
    ).innerHTML = `
      <h3>
        TOPIC CREATION PROGRESS
      </h3>

      <div class="progress-bar">
        <span
          style="width:${Math.min(
            100,
            (n / 20) * 100
          )}%"
        ></span>
      </div>

      <p>
        ${n} / 20 GENERAL notes
      </p>

      ${
        n >= 20
          ? `
            <a
              class="action-button green"
              href="create-topic.html"
            >
              CREATE TOPIC
            </a>
          `
          : `
            <p>
              Submit ${20 - n}
              more GENERAL notes
              to unlock.
            </p>
          `
      }
    `;

    el("logout-button").addEventListener(
      "click",
      async () => {
        await supabase.auth.signOut();

        location.href =
          "index.html";
      }
    );
  }


  /* =========================================================
     START APPLICATION
  ========================================================= */

  async function start() {
    if (
      page === "home" ||
      page === "topic"
    ) {
      await loadTopicPage();
    }

    else if (page === "note") {
      await loadSingleNote();
    }

    else if (page === "write") {
      await setupWriter(false);
    }

    else if (page === "edit") {
      await setupWriter(true);
    }

    else if (page === "login") {
      await initAuth();

      if (currentUser) {
        location.href =
          "index.html";
      } else {
        setupAuth(false);
      }
    }

    else if (page === "register") {
      await initAuth();

      if (currentUser) {
        location.href =
          "index.html";
      } else {
        setupAuth(true);
      }
    }

    else if (
      page === "create-topic"
    ) {
      await setupCreateTopic();
    }

    else if (page === "account") {
      await setupAccount();
    }
  }

  start();
})();
