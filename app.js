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
    const element = el(id);
    if (element) {
      element.textContent = value;
    }
  }

  function esc(value) {
    const d = document.createElement("div");

    d.textContent =
      value == null
        ? ""
        : String(value);

    return d.innerHTML;
  }

  function plain(html) {
    const d = document.createElement("div");

    d.innerHTML = html || "";

    return (
      d.textContent ||
      d.innerText ||
      ""
    )
      .replace(/\s+/g, " ")
      .trim();
  }

  function excerpt(html, n = 190) {
    const t = plain(html);

    return t.length > n
      ? t.slice(0, n).trim() + "…"
      : t;
  }

  function date(value) {
    return new Date(value).toLocaleString(
      undefined,
      {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "numeric",
        minute: "2-digit"
      }
    );
  }

  function query(name) {
    return new URLSearchParams(
      location.search
    ).get(name);
  }

  // ============================================================
  // SAFE HTML
  // ============================================================

  function safeHtml(html) {
    if (!window.DOMPurify) {
      return esc(plain(html));
    }

    return DOMPurify.sanitize(
      html || "",
      {
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
      }
    );
  }

  // ============================================================
  // SUPABASE CONFIGURATION
  // ============================================================

  function configured() {
    return (
      cfg.supabaseUrl &&
      cfg.supabaseKey &&
      !cfg.supabaseUrl.includes(
        "PASTE_YOUR"
      ) &&
      !cfg.supabaseKey.includes(
        "PASTE_YOUR"
      )
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

  // ============================================================
  // SUPABASE
  // ============================================================

  const supabase =
    window.supabase.createClient(
      cfg.supabaseUrl,
      cfg.supabaseKey
    );

  let session = null;
  let currentUser = null;

  // ============================================================
  // AUTHENTICATION
  // ============================================================

  async function initAuth() {
    const result =
      await supabase.auth.getSession();

    session =
      result.data.session;

    currentUser =
      session
        ? session.user
        : null;

    renderAuth();
  }

  function renderAuth() {
    const label =
      el("auth-label");

    const button =
      el("auth-button");

    if (label) {
      label.textContent =
        currentUser
          ? "@" +
            (
              currentUser
                .user_metadata
                ?.username ||
              currentUser.email
                ?.split("@")[0] ||
              "user"
            )
          : "";
    }

    if (button) {
      button.textContent =
        currentUser
          ? "ACCOUNT"
          : "LOGIN";

      button.href =
        currentUser
          ? "account.html"
          : "login.html";
    }

    const community =
      el("community-button");

    if (
      community &&
      currentUser
    ) {
      community.textContent =
        "ACCOUNT";

      community.href =
        "account.html";
    }
  }

  // ============================================================
  // PROFILE
  // ============================================================

  async function getProfile(userId) {
    const result =
      await supabase
        .from("profiles")
        .select(
          "id,username,display_name,bio,avatar_url,created_at"
        )
        .eq("id", userId)
        .maybeSingle();

    return result.data;
  }

  // ============================================================
  // TOPIC DRAWER
  // ============================================================

  function setupDrawer() {
    const sidebar =
      el("topic-sidebar");

    const backdrop =
      el("drawer-backdrop");

    el("topics-toggle")
      ?.addEventListener(
        "click",
        () => {
          sidebar?.classList.add(
            "open"
          );

          backdrop?.classList.add(
            "open"
          );
        }
      );

    el("topics-close")
      ?.addEventListener(
        "click",
        close
      );

    backdrop?.addEventListener(
      "click",
      close
    );

    function close() {
      sidebar?.classList.remove(
        "open"
      );

      backdrop?.classList.remove(
        "open"
      );
    }
  }

  // ============================================================
  // PAGINATION
  // ============================================================

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
      let p = Math.max(
        1,
        current - 2
      );

      p <=
      Math.min(
        total,
        current + 2
      );

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
      .querySelectorAll(
        "button:not(:disabled)"
      )
      .forEach((button) => {
        button.addEventListener(
          "click",
          () => {
            callback(
              Number(
                button.dataset.p
              )
            );
          }
        );
      });
  }
})();
  // ============================================================
  // LOAD TOPICS
  // ============================================================

  async function loadTopics(
    pageNo = Number(
      query("topics_page") || 1
    )
  ) {
    const list =
      el("topic-list");

    if (!list) {
      return;
    }

    const from =
      (pageNo - 1) *
      PAGE_SIZE;

    const to =
      from +
      PAGE_SIZE -
      1;

    const result =
      await supabase
        .from("topics")
        .select(
          `
          id,
          name,
          description,
          owner_id,
          created_at,
          profiles(
            username,
            display_name
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
        .range(
          from,
          to
        );

    if (result.error) {
      console.error(
        "Could not load topics:",
        result.error
      );

      list.innerHTML = `
        <div class="muted">
          ${esc(
            result.error.message
          )}
        </div>
      `;

      return;
    }

    list.innerHTML =
      result.data
        .map(
          (topic) => `
            <a
              class="topic-link"
              href="topic.html?id=${encodeURIComponent(
                topic.id
              )}"
            >
              <strong>
                ${esc(topic.name)}
              </strong>

              <small>
                @${esc(
                  topic.profiles
                    ?.username ||
                  "user"
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
        Math.ceil(
          (result.count || 0) /
            PAGE_SIZE
        )
      ),
      (p) => {
        const url =
          new URL(
            location.href
          );

        url.searchParams.set(
          "topics_page",
          p
        );

        history.pushState(
          {},
          "",
          url
        );

        loadTopics(p);
      }
    );
  }

  // ============================================================
  // GENERAL NOTE PROGRESS
  // ============================================================

  async function loadProgress() {
    const box =
      el("progress-box");

    if (!box) {
      return;
    }

    // User is not logged in
    if (!currentUser) {
      box.innerHTML = `
        <h3>
          TOPIC CREATION
        </h3>

        <p>
          Login and submit notes to
          GENERAL to unlock your own topic.
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

    const result =
      await supabase.rpc(
        "get_general_note_count",
        {
          p_user_id:
            currentUser.id
        }
      );

    if (result.error) {
      console.error(
        "Could not load GENERAL progress:",
        result.error
      );

      box.innerHTML = `
        <p class="muted">
          Progress unavailable.
        </p>
      `;

      return;
    }

    const count =
      Number(
        result.data || 0
      );

    const percentage =
      Math.min(
        100,
        (count / 20) * 100
      );

    box.innerHTML = `
      <h3>
        TOPIC CREATION
      </h3>

      <div class="progress-bar">
        <span
          style="width:${percentage}%"
        ></span>
      </div>

      <p>
        <strong>
          ${count} / 20
        </strong>
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
              Submit
              ${20 - count}
              more to unlock.
            </p>
          `
      }
    `;
  }

  // ============================================================
  // GET TOPIC
  // ============================================================

  async function getTopic(
    topicId
  ) {
    // GENERAL is represented by
    // topic_id = NULL in the notes table.
    //
    // Therefore we do NOT use a fake UUID
    // for GENERAL.

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

    const result =
      await supabase
        .from("topics")
        .select(
          `
          id,
          name,
          description,
          owner_id,
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
        .eq(
          "id",
          topicId
        )
        .maybeSingle();

    if (
      result.error ||
      !result.data
    ) {
      console.error(
        "Could not load topic:",
        result.error
      );

      return null;
    }

    return {
      ...result.data,
      isGeneral: false
    };
  }

  // ============================================================
  // LOAD NOTES
  // ============================================================

  async function loadNotes(
    topic,
    pageNo = Number(
      query("page") || 1
    )
  ) {
    const list =
      el("note-list");

    const status =
      el("page-status");

    if (!list) {
      return;
    }

    const from =
      (pageNo - 1) *
      PAGE_SIZE;

    const to =
      from +
      PAGE_SIZE -
      1;

    /*
     * IMPORTANT:
     *
     * GENERAL notes use:
     *
     *     topic_id = NULL
     *
     * They do NOT use a special UUID.
     *
     * Community topics use:
     *
     *     topic_id = topic.id
     */

    let request =
      supabase
        .from("notes")
        .select(
          `
          id,
          topic_id,
          author_id,
          title,
          content,
          created_at,
          updated_at,
          profiles(
            username,
            display_name
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
        .range(
          from,
          to
        );

    // ==========================================================
    // GENERAL
    // ==========================================================

    if (topic.isGeneral) {
      request =
        request.is(
          "topic_id",
          null
        );
    }

    // ==========================================================
    // NORMAL COMMUNITY TOPIC
    // ==========================================================

    else {
      request =
        request.eq(
          "topic_id",
          topic.id
        );
    }

    const result =
      await request;

    if (result.error) {
      console.error(
        "Could not load notes:",
        result.error
      );

      text(
        "page-status",
        "Could not load notes: " +
          result.error.message
      );

      return;
    }

    // ==========================================================
    // EMPTY STATE
    // ==========================================================

    if (
      status
    ) {
      status.textContent =
        result.data.length
          ? ""
          : "No notes have been posted here yet.";
    }

    // ==========================================================
    // RENDER NOTES
    // ==========================================================

    list.innerHTML =
      result.data
        .map((note) => {

          /*
           * GENERAL notes are anonymous.
           *
           * Notes in user-created topics show
           * the topic owner's name.
           */

          const owner =
            topic.isGeneral
              ? "Anonymous"
              : (
                  note.profiles
                    ?.display_name ||
                  note.profiles
                    ?.username ||
                  "User"
                );

          /*
           * Only the topic owner can manage
           * notes inside their topic.
           *
           * GENERAL notes cannot be edited
           * or deleted.
           */

          const manage =
            !topic.isGeneral &&
            currentUser &&
            note.author_id ===
              currentUser.id &&
            topic.owner_id ===
              currentUser.id;

          return `
            <article
              class="note-card"
            >

              <div
                class="note-main"
              >

                <div
                  class="note-author"
                >
                  ${esc(owner)}
                </div>

                <h2>
                  ${esc(note.title)}
                </h2>

                <p>
                  ${esc(
                    excerpt(
                      note.content
                    )
                  )}
                </p>

              </div>

              <div
                class="note-side"
              >

                <div
                  class="posted"
                >
                  Posted:
                  ${esc(
                    date(
                      note.created_at
                    )
                  )}
                </div>

                <div
                  class="note-actions"
                >

                  <a
                    class="read-button"
                    href="note.html?id=${encodeURIComponent(
                      note.id
                    )}"
                  >
                    READ →
                  </a>

                  ${
                    manage
                      ? `
                        <a
                          class="edit-link"
                          href="edit-note.html?id=${encodeURIComponent(
                            note.id
                          )}"
                        >
                          EDIT
                        </a>

                        <button
                          class="delete-link"
                          data-delete="${esc(
                            note.id
                          )}"
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

    // ==========================================================
    // DELETE BUTTONS
    // ==========================================================

    list
      .querySelectorAll(
        "[data-delete]"
      )
      .forEach((button) => {

        button.addEventListener(
          "click",
          () => {
            deleteNote(
              button.dataset.delete,
              topic
            );
          }
        );

      });

    // ==========================================================
    // NOTE PAGINATION
    // ==========================================================

    renderPagination(
      el("note-pagination"),
      pageNo,
      Math.max(
        1,
        Math.ceil(
          (result.count || 0) /
            PAGE_SIZE
        )
      ),
      (p) => {

        const url =
          new URL(
            location.href
          );

        url.searchParams.set(
          "page",
          p
        );

        history.pushState(
          {},
          "",
          url
        );

        loadNotes(
          topic,
          p
        );
      }
    );
  }

  // ============================================================
  // DELETE NOTE
  // ============================================================

  async function deleteNote(
    id,
    topic
  ) {
    /*
     * GENERAL notes can NEVER
     * be deleted from the frontend.
     */

    if (
      !currentUser ||
      topic.isGeneral
    ) {
      return;
    }

    if (
      !confirm(
        "Delete this note permanently?"
      )
    ) {
      return;
    }

    const result =
      await supabase
        .from("notes")
        .delete()
        .eq(
          "id",
          id
        );

    if (result.error) {
      alert(
        "Delete failed: " +
          result.error.message
      );

      return;
    }

    loadNotes(
      topic,
      Number(
        query("page") || 1
      )
    );
  }
  // ============================================================
  // TOPIC OWNER PANEL
  // ============================================================

  function renderOwner(topic) {
    const panel =
      el("owner-panel");

    if (!panel) {
      return;
    }

    // GENERAL TOPIC
    if (topic.isGeneral) {
      panel.innerHTML = `
        <div class="owner-badge">
          ★
        </div>

        <h2>
          GENERAL
        </h2>

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

    // USER-CREATED TOPIC
    const profile =
      topic.profiles || {};

    panel.innerHTML = `
      <div class="owner-avatar">
        ${esc(
          (
            profile.username ||
            "U"
          )
            .slice(0, 1)
            .toUpperCase()
        )}
      </div>

      <h2>
        @${esc(
          profile.username ||
          "user"
        )}
      </h2>

      <p>
        ${esc(
          profile.bio ||
          "This is my public notebook topic."
        )}
      </p>
    `;
  }

  // ============================================================
  // TOPIC PAGE
  // ============================================================

  async function loadTopicPage() {
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

    // ==========================================================
    // TOPIC HEADER
    // ==========================================================

    text(
      "current-topic-name",
      topic.name
    );

    text(
      "current-topic-description",
      topic.description || ""
    );

    // ==========================================================
    // OWNER INFORMATION
    // ==========================================================

    renderOwner(topic);

    // ==========================================================
    // WRITE BUTTON
    // ==========================================================

    const write =
      el("write-button");

    if (write) {

      /*
       * GENERAL:
       * Any logged-in user can write.
       *
       * USER TOPIC:
       * Only the topic owner can write.
       */

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

      write.href =
        topic.isGeneral
          ? "write.html?topic=general"
          : `write.html?topic=${encodeURIComponent(
              topic.id
            )}`;
    }

    // ==========================================================
    // LOAD NOTES
    // ==========================================================

    await loadNotes(
      topic
    );

    // ==========================================================
    // GENERAL LINK ACTIVE STATE
    // ==========================================================

    const generalLink =
      document.querySelector(
        ".general-link"
      );

    if (
      generalLink &&
      topic.isGeneral
    ) {
      generalLink.classList.add(
        "active"
      );
    }
  }

  // ============================================================
  // EDITOR TOOLBAR
  // ============================================================

  function setupToolbar() {

    const buttons =
      document.querySelectorAll(
        "[data-command]"
      );

    buttons.forEach(
      (button) => {

        button.addEventListener(
          "mousedown",
          (event) => {
            event.preventDefault();
          }
        );

        button.addEventListener(
          "click",
          () => {

            const command =
              button.dataset.command;

            document.execCommand(
              command,
              false,
              null
            );

            el("editor")?.focus();

            updateCounter();
          }
        );
      }
    );
  }

  // ============================================================
  // EDITOR CHARACTER COUNTER
  // ============================================================

  function updateCounter() {

    const editor =
      el("editor");

    const counter =
      el("counter");

    if (
      !editor ||
      !counter
    ) {
      return;
    }

    const count =
      (
        editor.innerText ||
        ""
      ).length;

    counter.textContent =
      `${count} / ${MAX_CONTENT}`;

    counter.classList.toggle(
      "limit-warning",
      count >
        MAX_CONTENT * 0.9
    );
  }

  // ============================================================
  // WRITER / EDITOR
  // ============================================================

  async function setupWriter(
    edit = false
  ) {

    await initAuth();

    setupDrawer();

    // ----------------------------------------------------------
    // LOGIN REQUIRED
    // ----------------------------------------------------------

    if (!currentUser) {
      location.href =
        "login.html";

      return;
    }

    // ----------------------------------------------------------
    // GET TOPIC
    // ----------------------------------------------------------

    const topic =
      await getTopic(
        query("topic") ||
        "general"
      );

    if (!topic) {
      text(
        "write-status",
        "Topic not found."
      );

      return;
    }

    // ----------------------------------------------------------
    // PERMISSION
    // ----------------------------------------------------------

    /*
     * GENERAL:
     * Any authenticated user can create
     * a note.
     *
     * USER TOPIC:
     * Only the topic owner can create
     * notes.
     */

    if (
      !topic.isGeneral &&
      topic.owner_id !==
        currentUser.id
    ) {

      text(
        "write-status",
        "Only the topic owner can add notes here."
      );

      return;
    }

    // ----------------------------------------------------------
    // WRITER HEADER
    // ----------------------------------------------------------

    text(
      "writer-topic",
      topic.name
    );

    const writerBack =
      el("writer-back");

    if (writerBack) {
      writerBack.href =
        `topic.html?id=${encodeURIComponent(
          topic.isGeneral
            ? "general"
            : topic.id
        )}`;
    }

    // ----------------------------------------------------------
    // TOOLBAR
    // ----------------------------------------------------------

    setupToolbar();

    updateCounter();

    const editor =
      el("editor");

    const title =
      el("title");

    const postButton =
      el("post-button");

    if (
      !editor ||
      !title ||
      !postButton
    ) {
      return;
    }

    // ----------------------------------------------------------
    // EDITOR INPUT
    // ----------------------------------------------------------

    editor.addEventListener(
      "input",
      () => {

        const content =
          editor.innerText ||
          "";

        if (
          content.length >
          MAX_CONTENT
        ) {

          editor.innerText =
            content.slice(
              0,
              MAX_CONTENT
            );
        }

        updateCounter();
      }
    );

    // ----------------------------------------------------------
    // EDIT MODE
    // ----------------------------------------------------------

    let noteId = null;

    if (edit) {

      noteId =
        query("id");

      if (!noteId) {

        text(
          "write-status",
          "No note was specified."
        );

        return;
      }

      const result =
        await supabase
          .from("notes")
          .select(
            `
            id,
            title,
            content,
            topic_id,
            author_id
            `
          )
          .eq(
            "id",
            noteId
          )
          .maybeSingle();

      if (
        result.error ||
        !result.data
      ) {

        console.error(
          "Could not load note:",
          result.error
        );

        text(
          "write-status",
          "This note could not be found."
        );

        return;
      }

      // --------------------------------------------------------
      // AUTHOR CHECK
      // --------------------------------------------------------

      if (
        result.data.author_id !==
        currentUser.id
      ) {

        text(
          "write-status",
          "You cannot edit this note."
        );

        return;
      }

      // --------------------------------------------------------
      // GET NOTE TOPIC
      // --------------------------------------------------------

      const noteTopic =
        await getTopic(
          result.data.topic_id
        );

      if (
        !noteTopic
      ) {

        text(
          "write-status",
          "The note's topic could not be found."
        );

        return;
      }

      // GENERAL NOTES ARE READ-ONLY
      if (
        noteTopic.isGeneral
      ) {

        text(
          "write-status",
          "GENERAL notes cannot be edited."
        );

        return;
      }

      // --------------------------------------------------------
      // TOPIC OWNER CHECK
      // --------------------------------------------------------

      if (
        noteTopic.owner_id !==
        currentUser.id
      ) {

        text(
          "write-status",
          "Only the topic owner can edit notes."
        );

        return;
      }

      // --------------------------------------------------------
      // LOAD NOTE INTO EDITOR
      // --------------------------------------------------------

      text(
        "writer-topic",
        noteTopic.name
      );

      title.value =
        result.data.title || "";

      editor.innerHTML =
        safeHtml(
          result.data.content
        );
    }

    // ==========================================================
    // POST / SAVE
    // ==========================================================

    postButton.addEventListener(
      "click",
      async () => {

        const cleanTitle =
          title.value.trim();

        const raw =
          editor.innerHTML.trim();

        const body =
          plain(raw);

        // ------------------------------------------------------
        // VALIDATION
        // ------------------------------------------------------

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

        // ------------------------------------------------------
        // SANITIZE
        // ------------------------------------------------------

        const clean =
          safeHtml(raw);

        postButton.disabled =
          true;

        text(
          "write-status",
          edit
            ? "Saving..."
            : "Posting..."
        );

        let result;

        // ======================================================
        // EDIT EXISTING NOTE
        // ======================================================

        if (edit) {

          result =
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

        }

        // ======================================================
        // CREATE NEW NOTE
        // ======================================================

        else {

          result =
            await supabase
              .from("notes")
              .insert({
                /*
                 * This is important:
                 *
                 * GENERAL =
                 * topic_id NULL
                 *
                 * Community topic =
                 * topic UUID
                 */

                topic_id:
                  topic.isGeneral
                    ? null
                    : topic.id,

                title:
                  cleanTitle,

                content:
                  clean
              })
              .select("id")
              .single();
        }
        if (
          result.error
        ) {

          console.error(
            "Note save failed:",
            result.error
          );

          text(
            "write-status",
            result.error.message
          );

          postButton.disabled =
            false;

          return;
        }

        location.href =
          `note.html?id=${encodeURIComponent(
            result.data.id
          )}`;
      }
    );
  }
  async function setupCreateTopic() {
    await initAuth();

    if (!currentUser) {
      location.href = "login.html";
      return;
    }

    const c = await supabase.rpc(
      "get_general_note_count",
      { p_user_id: currentUser.id }
    );

    if (c.error || Number(c.data || 0) < 20) {
      text(
        "topic-status",
        "You need 20 GENERAL notes before creating a topic."
      );
      return;
    }

    el("create-topic-button")?.addEventListener(
      "click",
      async () => {
        const name =
          el("topic-name")?.value.trim() || "";

        const description =
          el("topic-description")?.value.trim() || "";

        if (!name) {
          text("topic-status", "Enter a topic name.");
          return;
        }

        if (name.length > MAX_TITLE) {
          text(
            "topic-status",
            `Topic name must be ${MAX_TITLE} characters or fewer.`
          );
          return;
        }

        const button = el("create-topic-button");

        if (button) {
          button.disabled = true;
        }

        text("topic-status", "Creating...");

        const r = await supabase
          .from("topics")
          .insert({
            name,
            description
          })
          .select("id")
          .single();

        if (r.error) {
          console.error(r.error);

          text(
            "topic-status",
            "Could not create topic: " + r.error.message
          );

          if (button) {
            button.disabled = false;
          }

          return;
        }

        location.href =
          `topic.html?id=${encodeURIComponent(r.data.id)}`;
      }
    );
  }


  // ============================================================
  // ACCOUNT PAGE
  // ============================================================

  async function setupAccount() {
    await initAuth();

    if (!currentUser) {
      location.href = "login.html";
      return;
    }

    const profile =
      await getProfile(currentUser.id);

    const username =
      profile?.username ||
      currentUser.user_metadata?.username ||
      currentUser.email?.split("@")[0] ||
      "user";

    text(
      "account-name",
      "@" + username
    );

    text(
      "account-email",
      currentUser.email || ""
    );

    const countResult =
      await supabase.rpc(
        "get_general_note_count",
        {
          p_user_id: currentUser.id
        }
      );

    const count =
      countResult.error
        ? 0
        : Number(countResult.data || 0);

    const progress =
      el("account-progress");

    if (progress) {
      const percentage =
        Math.min(100, (count / 20) * 100);

      progress.innerHTML = `
        <h3>TOPIC CREATION PROGRESS</h3>

        <div class="progress-bar">
          <span style="width:${percentage}%"></span>
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
                Submit ${20 - count}
                more GENERAL notes to unlock.
              </p>
            `
        }
      `;
    }

    el("logout-button")?.addEventListener(
      "click",
      async () => {
        await supabase.auth.signOut();

        session = null;
        currentUser = null;

        location.href = "index.html";
      }
    );
  }


  // ============================================================
  // AUTHENTICATION
  // ============================================================

  async function setupAuth(register) {

    if (register) {
      setupDrawer();
    }

    const submit =
      el("auth-submit");

    if (!submit) {
      return;
    }

    submit.addEventListener(
      "click",
      async () => {

        const email =
          el("email")?.value.trim() || "";

        const password =
          el("password")?.value || "";

        const username =
          el("username")?.value.trim() || "";

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

        if (
          register &&
          username.length < 3
        ) {
          text(
            "auth-status",
            "Username must be at least 3 characters."
          );

          return;
        }

        submit.disabled = true;

        text(
          "auth-status",
          register
            ? "Creating account..."
            : "Logging in..."
        );

        let result;

        if (register) {

          /*
           * IMPORTANT:
           *
           * The redirect URL must point to the actual
           * GitHub Pages website, NOT localhost.
           *
           * Change this if your repository/site URL
           * is different.
           */

          const redirectUrl =
            `${location.origin}${location.pathname
              .replace(/register\.html$/i, "")}`;

          result =
            await supabase.auth.signUp({
              email,
              password,

              options: {
                data: {
                  username
                },

                emailRedirectTo:
                  redirectUrl
              }
            });

        } else {

          result =
            await supabase.auth.signInWithPassword({
              email,
              password
            });
        }

        if (result.error) {

          console.error(result.error);

          text(
            "auth-status",
            result.error.message
          );

          submit.disabled = false;

          return;
        }


        // --------------------------------------------------------
        // REGISTRATION
        // --------------------------------------------------------

        if (register) {

          /*
           * If Supabase email confirmation is enabled,
           * Supabase may return a user without a session.
           *
           * The application cannot safely bypass Supabase's
           * email-confirmation requirement from JavaScript.
           *
           * The correct fix is to disable "Confirm email"
           * inside Supabase Authentication settings if you
           * want registration to immediately log users in.
           */

          if (!result.data.session) {

            text(
              "auth-status",
              "Account created. If email confirmation is enabled in Supabase, please confirm your email before logging in."
            );

            submit.disabled = false;

            return;
          }
        }


        // --------------------------------------------------------
        // SUCCESS
        // --------------------------------------------------------

        session =
          result.data.session || null;

        currentUser =
          session?.user || null;

        location.href = "index.html";
      }
    );
  }


  // ============================================================
  // PAGE INITIALIZATION
  // ============================================================

  async function start() {

    try {

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

          location.href = "index.html";

        } else {

          setupAuth(false);
        }

      } else if (
        page === "register"
      ) {

        await initAuth();

        if (currentUser) {

          location.href = "index.html";

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

    } catch (error) {

      console.error(
        "Application initialization error:",
        error
      );

      text(
        "page-status",
        "The website encountered an error while loading."
      );

      text(
        "auth-status",
        "The website encountered an error while loading."
      );
    }
  }
  start();

})();
