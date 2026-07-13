const state = {
  token: null,
  category: "legal",
  role: "user",
  experience: null,
  providers: [],
};

const labels = {
  user: "ユーザー",
  orderer: "発注者",
  provider: "事業者",
  candidate: "リクルーター",
};

const elements = {
  category: document.querySelector("#category-select"),
  account: document.querySelector("#account-select"),
  role: document.querySelector("#role-select"),
  login: document.querySelector("#login-button"),
  logout: document.querySelector("#logout-button"),
  session: document.querySelector("#session-label"),
  message: document.querySelector("#message"),
  title: document.querySelector("#category-title"),
  badge: document.querySelector("#role-badge"),
  notice: document.querySelector("#category-notice"),
  modules: document.querySelector("#module-list"),
  workflowTitle: document.querySelector("#workflow-title"),
  workflowCopy: document.querySelector("#workflow-copy"),
  workflowOne: document.querySelector("#workflow-step-one"),
  workflowTwo: document.querySelector("#workflow-step-two"),
  workflowThree: document.querySelector("#workflow-step-three"),
  search: document.querySelector("#provider-search"),
  providers: document.querySelector("#provider-list"),
  requestPanel: document.querySelector("#request-panel"),
  requestForm: document.querySelector("#request-form"),
  requestProvider: document.querySelector("#request-provider"),
  jobs: document.querySelector("#job-list"),
};

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  }[character]));
}

function setMessage(message = "") {
  elements.message.textContent = message;
}

async function api(path, options = {}) {
  const headers = { "content-type": "application/json", ...(options.headers ?? {}) };
  if (state.token) headers.authorization = `Bearer ${state.token}`;
  const response = await fetch(path, { ...options, headers });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "操作に失敗しました。");
  return body;
}

function formatValue(value) {
  if (Array.isArray(value)) return value.map(escapeHtml).join(" / ");
  return escapeHtml(value);
}

function renderExperience(experience) {
  state.experience = experience;
  elements.title.textContent = experience.categoryLabel;
  elements.badge.textContent = labels[experience.role];
  elements.notice.textContent = experience.notices.join(" ");
  elements.modules.innerHTML = experience.visibleModules.map((module) => `<span>${escapeHtml(module)}</span>`).join("");

  const isBeauty = experience.category === "beauty";
  elements.workflowTitle.textContent = isBeauty ? "メニューから予約する" : "相談テーマから探す";
  elements.workflowCopy.textContent = isBeauty
    ? "メニュー、地域、スタイル事例を比較して、自分に合う店舗へつなげます。"
    : "相談テーマ、専門領域、対応地域を整理して、適切な事業者へつなげます。";
  elements.workflowOne.textContent = isBeauty ? "メニューを選ぶ" : "テーマを選ぶ";
  elements.workflowTwo.textContent = isBeauty ? "店舗を比較する" : "事業者を比較する";
  elements.workflowThree.textContent = isBeauty ? "予約する" : "相談する";
  elements.requestPanel.hidden = !experience.allowedActions.includes("request.create");
}

function renderProviders(items) {
  state.providers = items;
  elements.providers.innerHTML = items.length
    ? items.map((provider) => {
        const publicFields = Object.entries(provider)
          .filter(([key]) => !["id", "category", "name", "themes", "location"].includes(key))
          .slice(0, 3)
          .map(([key, value]) => `<span>${escapeHtml(key)}: ${formatValue(value)}</span>`)
          .join("");
        return `<article class="provider-item"><h3>${escapeHtml(provider.name)}</h3><div class="meta"><span>${escapeHtml(provider.location)}</span><span>${formatValue(provider.themes)}</span>${publicFields}</div></article>`;
      }).join("")
    : '<p class="empty">該当する事業者がありません。</p>';
  elements.requestProvider.innerHTML = items.map((provider) => `<option value="${escapeHtml(provider.id)}">${escapeHtml(provider.name)}</option>`).join("");
}

function renderJobs(items) {
  elements.jobs.innerHTML = items.length
    ? items.map((job) => `<article class="job-item"><h3>${escapeHtml(job.title)}</h3><div class="meta"><span>${escapeHtml(job.employmentType)}</span><span>${escapeHtml(job.location)}</span></div>${state.experience?.allowedActions.includes("application.create") ? `<button class="button ghost apply-button" data-job-id="${escapeHtml(job.id)}">この求人に応募</button>` : ""}</article>`).join("")
    : '<p class="empty">公開求人がありません。</p>';
  document.querySelectorAll(".apply-button").forEach((button) => {
    button.addEventListener("click", async () => {
      const message = window.prompt("応募メッセージを入力してください（10文字以上）");
      if (!message) return;
      try {
        await api(`/api/v1/jobs/${button.dataset.jobId}/applications`, { method: "POST", body: JSON.stringify({ message }) });
        setMessage("応募を送信しました。");
      } catch (error) {
        setMessage(error.message);
      }
    });
  });
}

async function reload() {
  const experienceBody = await api(`/api/v1/categories/${state.category}/experience`);
  renderExperience(experienceBody.experience);
  const search = elements.search.value.trim();
  const providers = await api(`/api/v1/providers?category=${encodeURIComponent(state.category)}${search ? `&search=${encodeURIComponent(search)}` : ""}`);
  renderProviders(providers.items);
  const jobs = await api(`/api/v1/jobs?category=${encodeURIComponent(state.category)}`);
  renderJobs(jobs.items);
  elements.session.textContent = state.token ? `${labels[state.role]} / ${state.category}` : "未ログイン";
}

async function login() {
  try {
    const body = await api("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: elements.account.value, password: "demo-password", category: state.category, role: elements.role.value }),
    });
    state.token = body.accessToken;
    state.role = body.principal.role;
    elements.login.hidden = true;
    elements.logout.hidden = false;
    setMessage(`${labels[state.role]}としてログインしました。`);
    await reload();
  } catch (error) {
    setMessage(error.message);
  }
}

async function logout() {
  try { await api("/api/v1/auth/logout", { method: "POST" }); } catch {}
  state.token = null;
  state.role = "user";
  elements.login.hidden = false;
  elements.logout.hidden = true;
  setMessage("ログアウトしました。");
  await reload();
}

elements.category.addEventListener("change", async () => {
  if (state.token) {
    try { await api("/api/v1/auth/logout", { method: "POST" }); } catch {}
    state.token = null;
    state.role = "user";
    elements.login.hidden = false;
    elements.logout.hidden = true;
  }
  state.category = elements.category.value;
  try { await reload(); } catch (error) { setMessage(error.message); }
});
elements.search.addEventListener("input", async () => {
  try {
    const body = await api(`/api/v1/providers?category=${encodeURIComponent(state.category)}&search=${encodeURIComponent(elements.search.value.trim())}`);
    renderProviders(body.items);
  } catch (error) { setMessage(error.message); }
});
elements.login.addEventListener("click", login);
elements.logout.addEventListener("click", logout);
elements.requestForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(elements.requestForm);
  try {
    await api("/api/v1/requests", {
      method: "POST",
      body: JSON.stringify({
        category: state.category,
        providerId: form.get("providerId"),
        title: form.get("title"),
        description: form.get("description"),
      }),
    });
    elements.requestForm.reset();
    setMessage("依頼を送信しました。");
  } catch (error) {
    setMessage(error.message);
  }
});

reload().catch((error) => setMessage(error.message));
