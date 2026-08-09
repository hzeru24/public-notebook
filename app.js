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
    if (el(id)) el(id).textContent = value;
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

  function setupDrawer() {
    const sidebar = el("topic-sidebar");
    const backdrop = el("drawer-backdrop");

    el("topics-toggle")?.addEventListener(
      "click",
      () => {
        sidebar?.classList.add("open");
        backdrop?.classList.add("open");
      }
    );

    el("topics-close")?.addEventListener(
      "click",
      close
    );

    backdrop?.addEventListener(
      "click",
      close
    );

    function close() {
      sidebar?.classList.remove("open");
      backdrop?.classList.remove("open");
    }
  }

  async function loadTopics(
    pageNo = Number(query("topics_page") || 1)
  ) {
    const list = el("topic-list");

    if (!list) return;

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
      list.innerHTML = `
        <div class="muted">
          ${esc(r.error.message)}
        </div>
      `;

      return;
    }

    list.innerHTML =
      r.data
        .map(
          (t) => `
            <a
              class="topic-link"
              href="topic.html?id=${encodeURIComponent(t.id)}"
            >
              <strong>${esc(t.name)}</strong>
              <small>
                @${esc(
                  t.profiles?.username || "user"
                )}
              </small>
            </a>
          `
        )
        .join("") ||
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

  function renderPagination(
    container,
    current,
    total,
    callback
  ) {
    if (!container) return;

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
        b.addEventListener(
          "click",
          () => callback(Number(b.dataset.p))
        );
      });
  }

  async function loadProgress() {
    const box = el("progress-box");

    if (!box) return;

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
              Submit ${20 - count} more
              to unlock.
            </p>
          `
      }
    `;
  }

  async function getTopic(topicId) {
    if (topicId === "general" || !topicId) {
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

  async function loadNotes(
    topic,
    pageNo = Number(query("page") || 1)
  ) {
    const list = el("note-list");
    const status = el("page-status");

    if (!list) return;

    /*
      GENERAL is stored internally with topic_id = NULL.

      Supabase/PostgREST cannot use .eq("topic_id", null)
      for this case, so use .is("topic_id", null).
    */

    const from =
      (pageNo - 1) * PAGE_SIZE;

    const to =
      from + PAGE_SIZE - 1;

    let request =
      supabase
        .from("notes")
        .select(
          `
            id,
            title,
            content,
            topic_id,
            author_id,
            created_at,
            profiles(
              username,
              display_name,
              avatar_url
            )
          `,
          {
            count: "exact"
          }
        )
        .order(
          "created_at",
          {
            ascending: false
          }
        )
        .range(from, to);

    if (topic.isGeneral) {
      request = request.is(
        "topic_id",
        null
      );
    } else {
      request = request.eq(
        "topic_id",
        topic.id
      );
    }

    const r = await request;

    if (r.error) {
      if (status) {
        status.textContent =
          r.error.message;
      }

      return;
    }

    if (status) {
      status.textContent = "";
    }

    list.innerHTML =
      r.data
        .map(
          (note) => `
            <article class="note-card">

              <div class="note-card-inner">

                <h2>
                  ${esc(note.title)}
                </h2>

                <div class="note-meta">
                  ${date(note.created_at)}
                </div>

                <p>
                  ${esc(
                    excerpt(
                      note.content
                    )
                  )}
                </p>

                <a
                  class="read-link"
                  href="note.html?id=${encodeURIComponent(note.id)}"
                >
                  READ →
                </a>

              </div>

            </article>
          `
        )
        .join("") ||
      `
        <div class="empty-state">
          No notes have been published yet.
        </div>
      `;

    renderPagination(
      el("note-pagination"),
      pageNo,
      Math.max(
        1,
        Math.ceil(
          (r.count || 0) /
          PAGE_SIZE
        )
      ),
      (p) => {
        const params =
          new URLSearchParams(
            location.search
          );

        params.set(
          "page",
          String(p)
        );

        location.href =
          `${location.pathname}?${params.toString()}`;
      }
    );
  }

  function renderOwnerPanel(topic) {
    const panel = el("owner-panel");

    if (!panel) return;

    if (!topic || topic.isGeneral) {
      panel.innerHTML = `
        <div class="owner-heading">
          OWNER
        </div>

        <div class="owner-badge">
          <span>◯</span>
        </div>

        <div class="owner-name">
          PUBLIC NOTEBOOK
        </div>

        <p class="owner-bio">
          A public space for shared thoughts,
          stories, and notes.
        </p>
      `;

      return;
    }

    const profile =
      topic.profiles || {};

    panel.innerHTML = `
      <div class="owner-heading">
        OWNER
      </div>

      <div class="owner-badge">

        ${
          profile.avatar_url
            ? `
              <img
                src="${esc(
                  profile.avatar_url
                )}"
                alt=""
              >
            `
            : `
              <span>◯</span>
            `
        }

      </div>

      <div class="owner-name">
        @${esc(
          profile.username ||
          "user"
        )}
      </div>

      ${
        profile.display_name
          ? `
            <div class="owner-display-name">
              ${esc(
                profile.display_name
              )}
            </div>
          `
          : ""
      }

      <p class="owner-bio">
        ${esc(
          profile.bio ||
          "No bio yet."
        )}
      </p>
    `;
  }

  async function loadTopicPage() {
    const topicId =
      query("id") || "general";

    const topic =
      await getTopic(topicId);

    const heading =
      el("topic-title");

    const description =
      el("topic-description");

    if (!topic) {
      if (heading) {
        heading.textContent =
          "Topic not found";
      }

      return;
    }

    if (heading) {
      heading.textContent =
        topic.name;
    }

    if (description) {
      description.textContent =
        topic.description || "";
    }

    renderOwnerPanel(topic);

    await loadNotes(topic);
  }

  async function loadSingleNote() {
    const id = query("id");

    const article =
      el("note");

    if (!article || !id) {
      return;
    }

    const r =
      await supabase
        .from("notes")
        .select(
          `
            id,
            title,
            content,
            topic_id,
            author_id,
            created_at,
            profiles(
              id,
              username,
              display_name,
              bio,
              avatar_url
            )
          `
        )
        .eq("id", id)
        .maybeSingle();

    if (r.error || !r.data) {
      article.innerHTML = `
        <div class="empty-state">
          Note not found.
        </div>
      `;

      return;
    }

    const note = r.data;

    const profile =
      note.profiles || {};

    article.innerHTML = `
      <header class="note-header">

        <h1>
          ${esc(note.title)}
        </h1>

        <div class="note-author">
          @${esc(
            profile.username ||
            "user"
          )}
        </div>

        <div class="note-date">
          ${date(note.created_at)}
        </div>

      </header>

      <div class="note-body">
        ${safeHtml(note.content)}
      </div>
    `;

    const back =
      el("back-topic");

    if (back) {
      back.href =
        note.topic_id
          ? `topic.html?id=${encodeURIComponent(note.topic_id)}`
          : "topic.html?id=general";
    }

    const topic =
      await getTopic(
        note.topic_id || "general"
      );

    renderOwnerPanel(topic);

    await loadComments(id);
  }
      editor?.addEventListener(
      "input",
      () => {
        if (
          (editor.innerText || "")
            .length >
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

    if (edit) {
      const noteId = query("id");

      if (!noteId) {
        text(
          "write-status",
          "Missing note ID."
        );

        return;
      }

      const r = await supabase
        .from("notes")
        .select(
          "id,title,content,topic_id,author_id"
        )
        .eq("id", noteId)
        .maybeSingle();

      if (r.error || !r.data) {
        text(
          "write-status",
          "Note not found."
        );

        return;
      }

      if (
        r.data.author_id !==
        currentUser.id
      ) {
        text(
          "write-status",
          "You cannot edit this note."
        );

        return;
      }

      if (
        !topic.isGeneral &&
        r.data.topic_id !==
        topic.id
      ) {
        text(
          "write-status",
          "This note does not belong to this topic."
        );

        return;
      }

      if (title) {
        title.value =
          r.data.title || "";
      }

      if (editor) {
        editor.innerHTML =
          safeHtml(
            r.data.content || ""
          );
      }

      updateCounter();
    }

    el("save-note")
      ?.addEventListener(
        "click",
        async () => {

          const titleValue =
            title?.value.trim() || "";

          const contentValue =
            editor?.innerHTML || "";

          const plainContent =
            plain(contentValue);

          if (
            !titleValue ||
            titleValue.length >
              MAX_TITLE
          ) {
            text(
              "write-status",
              "Enter a valid title."
            );

            return;
          }

          if (
            !plainContent ||
            plainContent.length >
              MAX_CONTENT
          ) {
            text(
              "write-status",
              "Enter valid note content."
            );

            return;
          }

          const button =
            el("save-note");

          if (button) {
            button.disabled = true;
          }

          text(
            "write-status",
            edit
              ? "Saving changes..."
              : "Publishing..."
          );

          let r;

          if (edit) {

            const noteId =
              query("id");

            r = await supabase
              .from("notes")
              .update({
                title: titleValue,
                content: contentValue
              })
              .eq(
                "id",
                noteId
              )
              .eq(
                "author_id",
                currentUser.id
              );

          } else {

            r = await supabase
              .from("notes")
              .insert({
                title: titleValue,
                content: contentValue,
                topic_id:
                  topic.isGeneral
                    ? null
                    : topic.id,
                author_id:
                  currentUser.id
              });

          }

          if (r.error) {

            text(
              "write-status",
              r.error.message
            );

            if (button) {
              button.disabled = false;
            }

            return;
          }

          if (edit) {

            location.href =
              `note.html?id=${encodeURIComponent(
                query("id")
              )}`;

          } else {

            location.href =
              `topic.html?id=${encodeURIComponent(
                topic.isGeneral
                  ? "general"
                  : topic.id
              )}`;

          }

        }
      );
  }

  function commentDate(v) {
    return new Date(v).toLocaleDateString(
      undefined,
      {
        year: "numeric",
        month: "short",
        day: "numeric"
      }
    );
  }

  async function loadComments(noteId) {

    const list =
      el("comments-list");

    const form =
      el("comment-form");

    const input =
      el("comment-input");

    const counter =
      el("comment-counter");

    const button =
      el("post-comment-button");

    const status =
      el("comment-status");

    if (!list) {
      return;
    }

    const refreshControls =
      () => {

        if (
          !input ||
          !counter ||
          !button
        ) {
          return;
        }

        const count =
          input.value
            .trim()
            .length;

        counter.textContent =
          `${count} / 100 characters minimum`;

        button.disabled =
          !currentUser ||
          count < 100;
      };

    if (!currentUser) {

      if (form) {

        form.innerHTML = `
          <div class="comment-login-note">

            <span>
              Sign in to leave a comment.
            </span>

            <a
              class="action-button blue"
              href="login.html"
            >
              LOGIN
            </a>

          </div>
        `;

      }

    } else if (
      input &&
      counter &&
      button
    ) {

      input.addEventListener(
        "input",
        refreshControls
      );

      refreshControls();

      button.addEventListener(
        "click",
        async () => {

          const content =
            input.value.trim();

          if (
            content.length < 100
          ) {

            if (status) {
              status.textContent =
                "Your comment must contain at least 100 characters.";
            }

            refreshControls();

            return;
          }

          if (
            content.length > 2000
          ) {

            if (status) {
              status.textContent =
                "Your comment cannot exceed 2,000 characters.";
            }

            return;
          }

          button.disabled = true;

          if (status) {
            status.textContent =
              "Posting comment...";
          }

          const r =
            await supabase
              .from("comments")
              .insert({
                note_id: noteId,
                author_id:
                  currentUser.id,
                content
              });

          if (r.error) {

            if (status) {
              status.textContent =
                r.error.message;
            }

            refreshControls();

            return;
          }

          input.value = "";

          if (status) {
            status.textContent =
              "Comment posted.";
          }

          refreshControls();

          await renderComments(
            noteId
          );

        }
      );

    }

    await renderComments(
      noteId
    );
  }

  async function renderComments(
    noteId
  ) {

    const list =
      el("comments-list");

    if (!list) {
      return;
    }

    const r =
      await supabase
        .from("comments")
        .select(
          "id,content,created_at,author_id,profiles(username,display_name)"
        )
        .eq(
          "note_id",
          noteId
        )
        .order(
          "created_at",
          {
            ascending: true
          }
        );

    if (r.error) {

      list.innerHTML = `
        <p class="comment-empty">
          Could not load comments:
          ${esc(r.error.message)}
        </p>
      `;

      return;
    }

    if (!r.data?.length) {

      list.innerHTML = `
        <p class="comment-empty">
          No comments yet.
          Be the first to leave a thoughtful note.
        </p>
      `;

      return;
    }

    list.innerHTML =
      r.data
        .map(
          (comment) => {

            const username =
              comment.profiles
                ?.username ||
              "user";

            return `
              <article
                class="comment-entry"
              >

                <span
                  class="comment-author"
                >
                  @${esc(
                    username
                  )}
                </span>

                <span
                  class="comment-date"
                >
                  (${esc(
                    commentDate(
                      comment.created_at
                    )
                  )})
                </span>:

                <span
                  class="comment-text"
                >
                  ${esc(
                    comment.content
                  )}
                </span>

              </article>
            `;

          }
        )
        .join("");
  }

  async function setupAuthPage() {

    const mode =
      document.body.dataset.authMode;

    if (!mode) {
      return;
    }

    await initAuth();

    const form =
      el("auth-form");

    if (!form) {
      return;
    }

    if (
      currentUser &&
      (
        mode === "login" ||
        mode === "register"
      )
    ) {

      location.href =
        "index.html";

      return;
    }

    form.addEventListener(
      "submit",
      async (event) => {

        event.preventDefault();

        const email =
          el("email")?.value
            .trim() || "";

        const password =
          el("password")?.value || "";

        const username =
          el("username")?.value
            .trim() || "";

        const displayName =
          el("display-name")
            ?.value.trim() || "";

        text(
          "auth-status",
          ""
        );

        if (
          !email ||
          !password
        ) {

          text(
            "auth-status",
            "Email and password are required."
          );

          return;
        }

        const button =
          form.querySelector(
            "button[type='submit']"
          );

        if (button) {
          button.disabled = true;
        }

        if (mode === "login") {

          const r =
            await supabase.auth.signInWithPassword(
              {
                email,
                password
              }
            );

          if (r.error) {

            text(
              "auth-status",
              r.error.message
            );

            if (button) {
              button.disabled = false;
            }

            return;
          }

          location.href =
            "index.html";

          return;
        }

        if (
          mode === "register"
        ) {

          if (
            !username ||
            username.length < 3
          ) {

            text(
              "auth-status",
              "Username must be at least 3 characters."
            );

            if (button) {
              button.disabled = false;
            }

            return;
          }

          const r =
            await supabase.auth.signUp(
              {
                email,
                password,
                options: {
                  data: {
                    username,
                    display_name:
                      displayName ||
                      username
                  }
                }
              }
            );

          if (r.error) {

            text(
              "auth-status",
              r.error.message
            );

            if (button) {
              button.disabled = false;
            }

            return;
          }

          /*
            Email confirmation is intentionally not
            required by the application UI.

            If Supabase's "Confirm email" setting is
            disabled, signUp() returns an active session.
          */

          if (r.data.session) {

            text(
              "auth-status",
              "Account created! You can now use your notebook."
            );

            setTimeout(
              () => {
                location.href =
                  "index.html";
              },
              700
            );

          } else {

            text(
              "auth-status",
              "Account created! You can now use your notebook."
            );

            if (button) {
              button.disabled = false;
            }

          }

        }

      }
    );
  }

  async function setupAccountPage() {

    await initAuth();

    if (!currentUser) {

      location.href =
        "login.html";

      return;
    }

    const profile =
      await getProfile(
        currentUser.id
      );

    if (el("account-username")) {
      el("account-username").value =
        profile?.username ||
        currentUser.user_metadata
          ?.username ||
        "";
    }

    if (el("account-display-name")) {
      el("account-display-name").value =
        profile?.display_name ||
        currentUser.user_metadata
          ?.display_name ||
        "";
    }

    if (el("account-bio")) {
      el("account-bio").value =
        profile?.bio || "";
    }

    if (el("account-avatar-url")) {
      el("account-avatar-url").value =
        profile?.avatar_url || "";
    }

    el("account-form")
      ?.addEventListener(
        "submit",
        async (event) => {

          event.preventDefault();

          const username =
            el("account-username")
              ?.value.trim() || "";

          const displayName =
            el("account-display-name")
              ?.value.trim() || "";

          const bio =
            el("account-bio")
              ?.value.trim() || "";

          const avatarUrl =
            el("account-avatar-url")
              ?.value.trim() || "";

          if (
            username.length < 3
          ) {

            text(
              "account-status",
              "Username must be at least 3 characters."
            );

            return;
          }

          const r =
            await supabase
              .from("profiles")
              .upsert(
                {
                  id:
                    currentUser.id,
                  username,
                  display_name:
                    displayName ||
                    username,
                  bio,
                  avatar_url:
                    avatarUrl ||
                    null
                },
                {
                  onConflict:
                    "id"
                }
              );

          if (r.error) {

            text(
              "account-status",
              r.error.message
            );

            return;
          }

          await supabase.auth.updateUser(
            {
              data: {
                username,
                display_name:
                  displayName ||
                  username
              }
            }
          );

          text(
            "account-status",
            "Account updated."
          );

          await initAuth();
        }
      );

    el("logout-button")
      ?.addEventListener(
        "click",
        async () => {

          await supabase.auth.signOut();

          location.href =
            "index.html";
        }
      );
  }

  async function setupCreateTopicPage() {

    await initAuth();

    if (!currentUser) {

      location.href =
        "login.html";

      return;
    }

    const count =
      await supabase.rpc(
        "get_general_note_count",
        {
          p_user_id:
            currentUser.id
        }
      );

    if (
      count.error ||
      Number(count.data || 0) < 20
    ) {

      text(
        "topic-status",
        "You need at least 20 GENERAL notes before creating a topic."
      );

      return;
    }

    el("topic-form")
      ?.addEventListener(
        "submit",
        async (event) => {

          event.preventDefault();

          const name =
            el("topic-name")
              ?.value.trim() || "";

          const description =
            el("topic-description")
              ?.value.trim() || "";

          if (
            !name ||
            name.length > 120
          ) {

            text(
              "topic-status",
              "Enter a valid topic name."
            );

            return;
          }

          const r =
            await supabase
              .from("topics")
              .insert({
                name,
                description,
                owner_id:
                  currentUser.id
              })
              .select("id")
              .single();

          if (r.error) {

            text(
              "topic-status",
              r.error.message
            );

            return;
          }

          location.href =
            `topic.html?id=${encodeURIComponent(
              r.data.id
            )}`;
        }
      );
  }

  async function setupIndexPage() {

    setupDrawer();

    await initAuth();

    await loadTopics();

    await loadProgress();

    const topic =
      await getTopic(
        query("id") ||
        "general"
      );

    if (!topic) {
      return;
    }

    const write =
      el("write-button");

    if (write) {

      const allowed =
        topic.isGeneral
          ? !!currentUser
          : !!currentUser &&
            currentUser.id ===
              topic.owner_id;

      write.style.display =
        allowed
          ? "inline-flex"
          : "none";
    }
  }

  async function setupReadPage() {

    setupDrawer();

    await initAuth();

    await loadTopics();

    await loadSingleNote();
  }

  async function boot() {

    if (page === "index") {
      await setupIndexPage();
      return;
    }

    if (page === "topic") {
      await loadTopicPage();
      return;
    }

    if (page === "note") {
      await setupReadPage();
      return;
    }

    if (page === "write") {
      await setupWriter(false);
      return;
    }

    if (page === "edit-note") {
      await setupWriter(true);
      return;
    }

    if (page === "login") {
      await setupAuthPage();
      return;
    }

    if (page === "register") {
      await setupAuthPage();
      return;
    }

    if (page === "account") {
      await setupAccountPage();
      return;
    }

    if (page === "create-topic") {
      await setupCreateTopicPage();
      return;
    }

  }

  boot();

})();
        }`
            : ""
        }

      </div>
    `;

    await loadComments(id);
  }

  function renderOwner(topic) {

    const panel =
      el("owner-panel");

    if (!panel) {
      return;
    }

    if (
      topic.isGeneral
    ) {

      panel.innerHTML = `
        <div class="owner-title">
          OWNER
        </div>

        <div class="owner-badge">
          <span>◯</span>
        </div>

        <div class="owner-name">
          PUBLIC NOTEBOOK
        </div>

        <p class="owner-bio">
          This is the public GENERAL
          notebook.
        </p>
      `;

      return;
    }

    const profile =
      topic.profiles || {};

    panel.innerHTML = `
      <div class="owner-title">
        OWNER
      </div>

      <div class="owner-badge">

        ${
          profile.avatar_url
            ? `
              <img
                src="${esc(
                  profile.avatar_url
                )}"
                alt=""
              >
            `
            : `
              <span>◯</span>
            `
        }

      </div>

      <div class="owner-name">
        @${esc(
          profile.username ||
          "user"
        )}
      </div>

      ${
        profile.display_name
          ? `
            <div class="owner-display-name">
              ${esc(
                profile.display_name
              )}
            </div>
          `
          : ""
      }

      <p class="owner-bio">
        ${esc(
          profile.bio ||
          "No bio yet."
        )}
      </p>
    `;
  }

  async function setupWriter(
    edit = false
  ) {

    await initAuth();

    if (!currentUser) {

      location.href =
        "login.html";

      return;
    }

    setupDrawer();

    await loadTopics();

    const topicId =
      query("topic") ||
      query("topic_id") ||
      "general";

    const topic =
      await getTopic(topicId);

    if (!topic) {

      text(
        "write-status",
        "Topic not found."
      );

      return;
    }

    /*
      GENERAL notes can be created by
      authenticated users.

      Notes in personal/community topics
      can only be created by the topic owner.
    */

    if (
      !topic.isGeneral &&
      topic.owner_id !==
        currentUser.id
    ) {

      text(
        "write-status",
        "Only the topic owner can post notes here."
      );

      return;
    }

    const title =
      el("note-title");

    const editor =
      el("note-editor");

    if (!title || !editor) {
      return;
    }

    text(
      "writer-topic",
      topic.name
    );

    let noteId = null;

    if (edit) {

      noteId =
        query("id");

      const r =
        await supabase
          .from("notes")
          .select(
            "id,title,content,topic_id,author_id"
          )
          .eq(
            "id",
            noteId
          )
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

      const t =
        await getTopic(
          r.data.topic_id
        );

      if (
        !t ||
        t.isGeneral ||
        t.owner_id !==
          currentUser.id
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
        safeHtml(
          r.data.content
        );
    }

    el("post-button")
      .addEventListener(
        "click",
        async () => {

          const cleanTitle =
            title.value.trim();

          const raw =
            editor.innerHTML.trim();

          const body =
            plain(raw);

          if (
            !cleanTitle ||
            !body
          ) {

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

          el(
            "post-button"
          ).disabled = true;

          text(
            "write-status",
            edit
              ? "Saving..."
              : "Posting..."
          );

          let r;

          if (edit) {

            /*
              Editing is only possible for
              notes in user-created topics.
            */

            r =
              await supabase
                .from("notes")
                .update({
                  title:
                    cleanTitle,

                  content:
                    clean,

                  updated_at:
                    new Date()
                      .toISOString()
                })
                .eq(
                  "id",
                  noteId
                )
                .select("id")
                .single();

          } else {

            /*
              IMPORTANT RLS FIX

              The Supabase RLS policy requires:

                  author_id = auth.uid()

              Therefore the logged-in user's
              UUID must explicitly be included
              in the INSERT request.

              Without this field, Supabase rejects
              the insert with:

              "new row violates row-level
               security policy for table notes"
            */

            r =
              await supabase
                .from("notes")
                .insert({

                  topic_id:
                    topic.isGeneral
                      ? null
                      : topic.id,

                  author_id:
                    currentUser.id,

                  title:
                    cleanTitle,

                  content:
                    clean

                })
                .select("id")
                .single();
          }

          if (r.error) {

            text(
              "write-status",
              r.error.message
            );

            el(
              "post-button"
            ).disabled = false;

            return;
          }

          location.href =
            `note.html?id=${encodeURIComponent(
              r.data.id
            )}`;

        }
      );
  }


  function commentDate(v) {

    return new Date(v)
      .toLocaleDateString(
        undefined,
        {
          year: "numeric",
          month: "short",
          day: "numeric"
        }
      );
  }


  async function loadComments(
    noteId
  ) {

    const list =
      el("comments-list");

    const form =
      el("comment-form");

    const input =
      el("comment-input");

    const counter =
      el("comment-counter");

    const button =
      el("post-comment-button");

    const status =
      el("comment-status");

    if (!list) {
      return;
    }

    const refreshControls =
      () => {

        if (
          !input ||
          !counter ||
          !button
        ) {
          return;
        }

        const count =
          input.value
            .trim()
            .length;

        counter.textContent =
          `${count} / 100 characters minimum`;

        button.disabled =
          !currentUser ||
          count < 100;
      };


    if (!currentUser) {

      if (form) {

        form.innerHTML = `
          <div class="comment-login-note">

            <span>
              Sign in to leave a comment.
            </span>

            <a
              class="action-button blue"
              href="login.html"
            >
              LOGIN
            </a>

          </div>
        `;

      }

    } else if (
      input &&
      counter &&
      button
    ) {

      input.addEventListener(
        "input",
        refreshControls
      );

      refreshControls();


      button.addEventListener(
        "click",
        async () => {

          const content =
            input.value.trim();


          if (
            content.length < 100
          ) {

            if (status) {

              status.textContent =
                "Your comment must contain at least 100 characters.";

            }

            refreshControls();

            return;
          }


          if (
            content.length > 2000
          ) {

            if (status) {

              status.textContent =
                "Your comment cannot exceed 2,000 characters.";

            }

            return;
          }


          button.disabled =
            true;

          if (status) {

            status.textContent =
              "Posting comment.";

          }


          const r =
            await supabase
              .from("comments")
              .insert({

                note_id:
                  noteId,

                author_id:
                  currentUser.id,

                content:
                  content

              });


          if (r.error) {

            if (status) {

              status.textContent =
                r.error.message;

            }

            refreshControls();

            return;
          }


          input.value = "";

          if (status) {

            status.textContent =
              "Comment posted.";

          }

          refreshControls();

          await renderComments(
            noteId
          );

        }
      );

    }


    await renderComments(
      noteId
    );
  }


  async function renderComments(
    noteId
  ) {

    const list =
      el("comments-list");

    if (!list) {
      return;
    }


    const r =
      await supabase
        .from("comments")
        .select(
          "id,content,created_at,author_id,profiles(username,display_name)"
        )
        .eq(
          "note_id",
          noteId
        )
        .order(
          "created_at",
          {
            ascending: true
          }
        );


    if (r.error) {

      list.innerHTML = `
        <p class="comment-empty">
          Could not load comments:
          ${esc(
            r.error.message
          )}
        </p>
      `;

      return;
    }


    if (
      !r.data?.length
    ) {

      list.innerHTML = `
        <p class="comment-empty">
          No comments yet.
          Be the first to leave a thoughtful note.
        </p>
      `;

      return;
    }


    list.innerHTML =
      r.data
        .map(
          (comment) => {

            const username =
              comment.profiles
                ?.username ||
              "user";

            return `
              <article
                class="comment-entry"
              >

                <span
                  class="comment-author"
                >
                  @${esc(
                    username
                  )}
                </span>

                <span
                  class="comment-date"
                >
                  (${esc(
                    commentDate(
                      comment.created_at
                    )
                  )})
                </span>:

                <span
                  class="comment-text"
                >
                  ${esc(
                    comment.content
                  )}
                </span>

              </article>
            `;

          }
        )
        .join("");
  }


  async function setupAuthPage() {

    const mode =
      document.body
        .dataset
        .authMode;

    if (!mode) {
      return;
    }


    await initAuth();


    const form =
      el("auth-form");

    if (!form) {
      return;
    }


    if (
      currentUser &&
      (
        mode === "login" ||
        mode === "register"
      )
    ) {

      location.href =
        "index.html";

      return;
    }


    form.addEventListener(
      "submit",
      async (event) => {

        event.preventDefault();


        const email =
          el("email")
            ?.value
            .trim() ||
          "";

        const password =
          el("password")
            ?.value ||
          "";

        const username =
          el("username")
            ?.value
            .trim() ||
          "";

        const displayName =
          el("display-name")
            ?.value
            .trim() ||
          "";


        text(
          "auth-status",
          ""
        );


        if (
          !email ||
          !password
        ) {

          text(
            "auth-status",
            "Email and password are required."
          );

          return;
        }


        const button =
          form.querySelector(
            "button[type='submit']"
          );


        if (button) {
          button.disabled =
            true;
        }


        if (
          mode === "login"
        ) {

          const r =
            await supabase
              .auth
              .signInWithPassword({
                email,
                password
              });


          if (r.error) {

            text(
              "auth-status",
              r.error.message
            );

            if (button) {
              button.disabled =
                false;
            }

            return;
          }


          location.href =
            "index.html";

          return;
        }


        if (
          mode === "register"
        ) {

          if (
            !username ||
            username.length < 3
          ) {

            text(
              "auth-status",
              "Username must be at least 3 characters."
            );

            if (button) {
              button.disabled =
                false;
            }

            return;
          }


          const r =
            await supabase
              .auth
              .signUp({

                email,

                password,

                options: {

                  data: {

                    username,

                    display_name:
                      displayName ||
                      username

                  }

                }

              });


          if (r.error) {

            text(
              "auth-status",
              r.error.message
            );

            if (button) {
              button.disabled =
                false;
            }

            return;
          }


          /*
            Email confirmation is intentionally
            not required by the application UI.

            If Supabase's "Confirm email" setting
            is disabled, signUp() returns an
            active session.
          */


          if (
            r.data.session
          ) {

            text(
              "auth-status",
              "Account created! You can now use your notebook."
            );


            setTimeout(
              () => {

                location.href =
                  "index.html";

              },
              700
            );


          } else {

            text(
              "auth-status",
              "Account created! You can now use your notebook."
            );


            if (button) {

              button.disabled =
                false;

            }

          }

        }

      }
    );
  }
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

    el(
      "single-delete"
    )?.addEventListener(
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
              .eq(
                "id",
                id
              );

          if (d.error) {
            alert(
              d.error.message
            );
          } else {
            location.href =
              el(
                "back-topic"
              ).href;
          }
        }
      }
    );

    await loadComments(id);
  }

  async function setupAuth(
    register
  ) {
    if (register) {
      setupDrawer();
    }

    el("auth-submit")
      ?.addEventListener(
        "click",
        async () => {
          const email =
            el("email")
              ?.value.trim();

          const password =
            el("password")
              ?.value;

          const username =
            el("username")
              ?.value.trim();

          if (
            !email ||
            !password ||
            (register &&
              !username)
          ) {
            text(
              "auth-status",
              "Please complete all fields."
            );

            return;
          }

          el(
            "auth-submit"
          ).disabled = true;

          text(
            "auth-status",
            register
              ? "Creating account..."
              : "Logging in..."
          );

          let r;

          if (register) {
            r =
              await supabase.auth.signUp(
                {
                  email,
                  password,
                  options: {
                    data: {
                      username
                    }
                  }
                }
              );
          } else {
            r =
              await supabase.auth.signInWithPassword(
                {
                  email,
                  password
                }
              );
          }

          if (r.error) {
            text(
              "auth-status",
              r.error.message
            );

            el(
              "auth-submit"
            ).disabled = false;

            return;
          }

          if (
            register &&
            !r.data.session
          ) {
            text(
              "auth-status",
              "Account created! You can now use your notebook."
            );

            el(
              "auth-submit"
            ).disabled = false;

            return;
          }

          location.href =
            "index.html";
        }
      );
  }

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

    el(
      "create-topic-button"
    ).addEventListener(
      "click",
      async () => {
        const name =
          el("topic-name")
            .value.trim();

        const description =
          el(
            "topic-description"
          ).value.trim();

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
        (p?.username ||
          "user")
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

    el(
      "logout-button"
    ).addEventListener(
      "click",
      async () => {
        await supabase.auth.signOut();

        location.href =
          "index.html";
      }
    );
  }

  async function start() {
    if (
      page === "home" ||
      page === "topic"
    ) {
      await loadTopicPage();

    } else if (
      page === "note"
    ) {
      await loadSingleNote();

    } else if (
      page === "write"
    ) {
      await setupWriter(false);

    } else if (
      page === "edit"
    ) {
      await setupWriter(true);

    } else if (
      page === "login"
    ) {
      await initAuth();

      if (currentUser) {
        location.href =
          "index.html";
      } else {
        setupAuth(false);
      }

    } else if (
      page === "register"
    ) {
      await initAuth();

      if (currentUser) {
        location.href =
          "index.html";
      } else {
        setupAuth(true);
      }

    } else if (
      page === "create-topic"
    ) {
      await setupCreateTopic();

    } else if (
      page === "account"
    ) {
      await setupAccount();
    }
  }

  start();
})();
