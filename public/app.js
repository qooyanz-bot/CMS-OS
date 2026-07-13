const state = {
  token: null,
  mfaChallengeToken: null,
  principal: null,
  category: "legal",
  role: "user",
  authCapabilities: { passwordLogin: true, oidcLogin: false, mfaEnrollment: false },
  experience: null,
  providers: [],
  directoryGuides: [],
  requests: [],
  applications: [],
  inquiries: [],
  notifications: [],
  proposals: [],
  contents: [],
};

const listRequestVersions = {
  providers: 0,
  requests: 0,
  applications: 0,
  jobs: 0,
  directories: 0,
};

const labels = {
  user: "ユーザー",
  orderer: "発注者",
  provider: "事業者",
  candidate: "リクルーター",
};

const moduleLabels = {
  themeGuide: "テーマガイド",
  menuSearch: "メニュー検索",
  providerSearch: "事業者を探す",
  providerProfile: "事業者プロフィール",
  legalDisclaimer: "注意事項",
  faq: "よくある質問",
  styleGallery: "スタイル事例",
  requestCase: "依頼内容",
  requestQuote: "見積もり相談",
  secureMessage: "安全なメッセージ",
  requestMessage: "相談メッセージ",
  shortlist: "候補リスト",
  requestHistory: "依頼履歴",
  booking: "予約",
  bookingHistory: "予約履歴",
  providerDashboard: "事業者ダッシュボード",
  listingManagement: "掲載情報管理",
  inquiryManagement: "問い合わせ管理",
  menuManagement: "メニュー管理",
  bookingManagement: "予約管理",
  styleManagement: "スタイル管理",
  jobManagement: "求人管理",
  contentAssistant: "AIコンテンツ編集",
  seoAssistant: "SEOアシスタント",
  jobSearch: "求人を探す",
  culture: "働き方・文化",
  application: "応募",
  applicationStatus: "応募状況",
};

const elements = {
  category: document.querySelector("#category-select"),
  account: document.querySelector("#account-select"),
  role: document.querySelector("#role-select"),
  loginForm: document.querySelector("#login-form"),
  email: document.querySelector("#login-email"),
  password: document.querySelector("#login-password"),
  login: document.querySelector("#login-button"),
  oidc: document.querySelector("#oidc-button"),
  logout: document.querySelector("#logout-button"),
  demoPanel: document.querySelector("#demo-account-panel"),
  mfaPanel: document.querySelector("#mfa-panel"),
  mfaForm: document.querySelector("#mfa-form"),
  mfaCode: document.querySelector("#mfa-code"),
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
  providerTheme: document.querySelector("#provider-theme-filter"),
  providerLocation: document.querySelector("#provider-location-filter"),
  providerSort: document.querySelector("#provider-sort"),
  providers: document.querySelector("#provider-list"),
  providerPagination: document.querySelector("#provider-pagination"),
  providerStatus: document.querySelector("#provider-list-status"),
  directoryGuidePanel: document.querySelector("#directory-guide-panel"),
  directoryGuideList: document.querySelector("#directory-guide-list"),
  directoryGuideStatus: document.querySelector("#directory-guide-status"),
  requestPanel: document.querySelector("#request-panel"),
  requestForm: document.querySelector("#request-form"),
  requestProvider: document.querySelector("#request-provider"),
  inquiryPanel: document.querySelector("#inquiry-panel"),
  inquiryForm: document.querySelector("#inquiry-form"),
  inquiryProvider: document.querySelector("#inquiry-provider"),
  inquiryStatusPanel: document.querySelector("#inquiry-status-panel"),
  inquiryList: document.querySelector("#inquiry-list"),
  inquiryManagementPanel: document.querySelector("#inquiry-management-panel"),
  inquiryManagementList: document.querySelector("#inquiry-management-list"),
  notificationPanel: document.querySelector("#notification-panel"),
  notificationList: document.querySelector("#notification-list"),
  requestInboxPanel: document.querySelector("#request-inbox-panel"),
  requestList: document.querySelector("#request-list"),
  requestSearch: document.querySelector("#request-search-filter"),
  requestStatus: document.querySelector("#request-status-filter"),
  requestSort: document.querySelector("#request-sort"),
  requestPagination: document.querySelector("#request-pagination"),
  requestStatusMessage: document.querySelector("#request-list-status"),
  applicationPanel: document.querySelector("#application-panel"),
  applicationList: document.querySelector("#application-list"),
  applicationSearch: document.querySelector("#application-search-filter"),
  applicationJob: document.querySelector("#application-job-filter"),
  applicationStatus: document.querySelector("#application-status-filter"),
  applicationSort: document.querySelector("#application-sort"),
  applicationPagination: document.querySelector("#application-pagination"),
  applicationStatusMessage: document.querySelector("#application-list-status"),
  jobs: document.querySelector("#job-list"),
  jobSearch: document.querySelector("#job-search-filter"),
  jobEmployment: document.querySelector("#job-employment-filter"),
  jobLocation: document.querySelector("#job-location-filter"),
  jobStatus: document.querySelector("#job-status-filter"),
  jobSort: document.querySelector("#job-sort"),
  jobPagination: document.querySelector("#job-pagination"),
  jobStatusMessage: document.querySelector("#job-list-status"),
  contentPanel: document.querySelector("#content-editor-panel"),
  contentForm: document.querySelector("#content-proposal-form"),
  contentMessage: document.querySelector("#content-message"),
  proposals: document.querySelector("#proposal-list"),
  contents: document.querySelector("#content-list"),
  publicationHistory: document.querySelector("#publication-history-list"),
  contentPreview: document.querySelector("#content-preview"),
  providerManagementPanel: document.querySelector("#provider-management-panel"),
  providerManagementForm: document.querySelector("#provider-management-form"),
  providerManagementMessage: document.querySelector("#provider-management-message"),
  listingStatus: document.querySelector("#listing-status"),
  listingSubmitButton: document.querySelector("#listing-submit-button"),
  jobManagementPanel: document.querySelector("#job-management-panel"),
  jobManagementForm: document.querySelector("#job-management-form"),
  jobManagementMessage: document.querySelector("#job-management-message"),
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

function setContentMessage(message = "") {
  elements.contentMessage.textContent = message;
}

function beginListRequest(name, target) {
  listRequestVersions[name] += 1;
  target?.setAttribute("aria-busy", "true");
  return listRequestVersions[name];
}

function isLatestListRequest(name, version) {
  return listRequestVersions[name] === version;
}

function finishListRequest(name, version, target) {
  if (isLatestListRequest(name, version)) target?.setAttribute("aria-busy", "false");
}

function invalidateListRequest(name, target, statusTarget) {
  listRequestVersions[name] += 1;
  target?.setAttribute("aria-busy", "false");
  setListStatus(statusTarget);
}

function setListStatus(target, status = "", message = "", retryFunction) {
  if (!target) return;
  target.replaceChildren();
  target.hidden = !status;
  target.className = `list-state${status ? ` ${status}` : ""}`;
  target.setAttribute("role", status === "error" ? "alert" : "status");
  if (!status) return;

  const text = document.createElement("span");
  text.textContent = message;
  target.append(text);
  if (status !== "error" || !retryFunction) return;

  const retryButton = document.createElement("button");
  retryButton.type = "button";
  retryButton.className = "button ghost";
  retryButton.textContent = "再試行";
  retryButton.addEventListener("click", () => {
    retryButton.disabled = true;
    void retryFunction().catch((error) => setMessage(error.message));
  });
  target.append(retryButton);
}

async function api(path, options = {}) {
  const headers = { "content-type": "application/json", ...(options.headers ?? {}) };
  if (state.token) headers.authorization = `Bearer ${state.token}`;
  const response = await fetch(path, { ...options, headers });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "操作に失敗しました。");
  return body;
}

function updateAuthUi() {
  elements.loginForm.hidden = !state.authCapabilities.passwordLogin;
  elements.oidc.hidden = !state.authCapabilities.oidcLogin;
  elements.demoPanel.hidden = !state.authCapabilities.passwordLogin;
  elements.password.required = state.authCapabilities.passwordLogin;
}

async function loadAuthConfig() {
  const body = await api("/api/v1/auth/config");
  state.authCapabilities = body.item;
  updateAuthUi();
}

function setMfaChallenge(challengeToken) {
  state.mfaChallengeToken = challengeToken;
  elements.mfaPanel.hidden = false;
  elements.mfaCode.value = "";
  elements.mfaCode.focus();
  setMessage("認証アプリのコードを入力してください。");
}

function finishLogin(result) {
  if (result.mfaRequired) {
    setMfaChallenge(result.mfaChallengeToken);
    return false;
  }
  state.token = result.accessToken;
  state.principal = result.principal;
  state.mfaChallengeToken = null;
  state.role = result.principal.role;
  elements.mfaPanel.hidden = true;
  elements.loginForm.hidden = true;
  elements.oidc.hidden = true;
  elements.demoPanel.hidden = true;
  elements.logout.hidden = false;
  return true;
}

function formatValue(value) {
  if (Array.isArray(value)) return value.map(escapeHtml).join(" / ");
  return escapeHtml(value);
}

function renderExperience(experience, navigation = []) {
  state.experience = experience;
  elements.title.textContent = experience.categoryLabel;
  elements.badge.textContent = labels[experience.role];
  elements.notice.textContent = experience.notices.join(" ");
  const navigationLabels = Object.fromEntries(navigation.map((item) => [item.id, item.label]));
  elements.modules.innerHTML = experience.visibleModules
    .map((module) => `<span>${escapeHtml(moduleLabels[module] ?? navigationLabels[module] ?? module)}</span>`)
    .join("");

  const isBeauty = experience.category === "beauty";
  const isLegal = experience.category === "legal";
  elements.workflowTitle.textContent = isBeauty ? "メニューから予約する" : isLegal ? "相談テーマから探す" : "テーマから事業者を探す";
  elements.workflowCopy.textContent = isBeauty
    ? "メニュー、地域、スタイル事例を比較して、自分に合う店舗へつなげます。"
    : isLegal
      ? "相談テーマ、専門領域、対応地域を整理して、適切な事業者へつなげます。"
      : "テーマ、対応領域、地域を整理して、目的に合う事業者へつなげます。";
  elements.workflowOne.textContent = isBeauty ? "メニューを選ぶ" : "テーマを選ぶ";
  elements.workflowTwo.textContent = isBeauty ? "店舗を比較する" : "事業者を比較する";
  elements.workflowThree.textContent = isBeauty ? "予約する" : isLegal ? "相談する" : "問い合わせる";
  elements.requestPanel.hidden = !experience.allowedActions.includes("request.create");
  elements.inquiryPanel.hidden = !experience.allowedActions.includes("inquiry.create");
  const canSeeJobs = experience.visibleModules.includes("jobSearch") || experience.visibleModules.includes("jobManagement");
  elements.jobPanel.hidden = !canSeeJobs;
  if (!canSeeJobs) clearJobView();
}

function renderListPagination(target, page = {}, cursor = "", reloadFunction, label) {
  if (!target) return;
  target.replaceChildren();
  const hasPrevious = Boolean(cursor);
  const hasNext = Boolean(page.nextCursor);
  if (!hasPrevious && !hasNext) return;

  const nav = document.createElement("nav");
  nav.setAttribute("aria-label", label);
  const status = document.createElement("span");
  status.className = "page-status";
  status.textContent = hasNext ? "続きの一覧があります" : "一覧の末尾です";
  nav.append(status);

  const addButton = (text, nextCursor, ariaLabel) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button ghost";
    button.textContent = text;
    button.setAttribute("aria-label", ariaLabel);
    button.addEventListener("click", () => {
      button.disabled = true;
      void reloadFunction(nextCursor)
        .then(() => target.querySelector("button")?.focus())
        .catch((error) => setMessage(error.message));
    });
    nav.append(button);
  };

  if (hasPrevious) addButton("先頭へ", "", `${label}の先頭へ戻る`);
  if (hasNext) addButton("次へ", page.nextCursor, `${label}の次のページを表示`);
  target.append(nav);
}

function renderProviders(items, page = {}, cursor = "") {
  state.providers = items;
  elements.providers.innerHTML = items.length
    ? items.map((provider) => {
        const publicFields = Object.entries(provider)
          .filter(([key]) => !["id", "category", "name", "themes", "location"].includes(key))
          .slice(0, 3)
          .map(([key, value]) => `<span>${escapeHtml(key)}: ${formatValue(value)}</span>`)
          .join("");
        const contactButton = state.token && state.experience?.allowedActions.includes("inquiry.create")
          ? `<button class="button ghost inquiry-provider-button" data-provider-id="${escapeHtml(provider.id)}">この事業者へ問い合わせ</button>`
          : "";
        return `<article class="provider-item"><h3>${escapeHtml(provider.name)}</h3><div class="meta"><span>${escapeHtml(provider.location)}</span><span>${formatValue(provider.themes)}</span>${publicFields}</div>${contactButton}</article>`;
      }).join("")
    : '<p class="empty">該当する事業者がありません。</p>';
  elements.requestProvider.innerHTML = items.map((provider) => `<option value="${escapeHtml(provider.id)}">${escapeHtml(provider.name)}</option>`).join("");
  elements.inquiryProvider.innerHTML = items.map((provider) => `<option value="${escapeHtml(provider.id)}">${escapeHtml(provider.name)}</option>`).join("");
  document.querySelectorAll(".inquiry-provider-button").forEach((button) => {
    button.addEventListener("click", () => {
      elements.inquiryProvider.value = button.dataset.providerId ?? "";
      elements.inquiryForm.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });
  renderListPagination(elements.providerPagination, page, cursor, reloadProviders, "事業者一覧のページ移動");
}

const directoryGuideKindLabels = { directory: "検索・相談", booking: "検索・予約", provider_resource: "事業者向け" };

function renderDirectoryGuides(items) {
  state.directoryGuides = items;
  elements.directoryGuideList.setAttribute("aria-busy", "false");
  elements.directoryGuidePanel.hidden = items.length === 0;
  elements.directoryGuideList.innerHTML = items.length
    ? items.map((guide) => `<article class="directory-guide-item"><div class="meta"><span>${escapeHtml(directoryGuideKindLabels[guide.kind] ?? guide.kind)}</span><span>確認日 ${escapeHtml(guide.verifiedAt)}</span></div><h3><a href="${escapeHtml(guide.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(guide.name)}</a></h3><p>${escapeHtml(guide.description)}</p></article>`).join("")
    : "";
}

const requestStatusLabels = { submitted: "受付中", accepted: "対応中", closed: "終了" };
const applicationStatusLabels = { submitted: "受付中", screening: "選考中", closed: "終了" };
const inquiryStatusLabels = { open: "受付中", responded: "返信済み", closed: "終了" };

function roleStatusButtons(actions) {
  return actions.map(([status, label]) => `<button class="button ghost role-status-button" data-status="${escapeHtml(status)}">${escapeHtml(label)}</button>`).join("");
}

function renderRequests(items, page = {}, cursor = "") {
  state.requests = items;
  elements.requestList.innerHTML = items.length
    ? items.map((request) => {
        const actions = state.experience?.allowedActions.includes("request.status.update")
          ? state.role === "provider"
            ? request.status === "submitted" ? [["accepted", "対応を開始"], ["closed", "終了"]] : request.status === "accepted" ? [["closed", "終了"]] : []
            : request.status === "closed" ? [] : [["closed", "依頼を終了"]]
          : [];
        return `<article class="role-item" data-request-id="${escapeHtml(request.id)}"><div class="meta"><span>${escapeHtml(requestStatusLabels[request.status] ?? request.status)}</span></div><h3>${escapeHtml(request.title)}</h3><p>${escapeHtml(request.description)}</p><div class="role-actions">${roleStatusButtons(actions)}</div></article>`;
      }).join("")
    : '<p class="empty">表示できる依頼はありません。</p>';
  document.querySelectorAll("[data-request-id] .role-status-button").forEach((button) => {
    button.addEventListener("click", () => {
      const requestItem = button.closest("[data-request-id]");
      if (requestItem?.dataset.requestId) void updateRoleStatus("requests", requestItem.dataset.requestId, button.dataset.status ?? "");
    });
  });
  renderListPagination(elements.requestPagination, page, cursor, reloadRequests, "依頼一覧のページ移動");
}

function renderInquiries(items) {
  state.inquiries = items;
  const isProvider = state.role === "provider";
  const target = isProvider ? elements.inquiryManagementList : elements.inquiryList;
  target.innerHTML = items.length
    ? items.map((inquiry) => {
        const actions = isProvider
          ? inquiry.status === "open" ? [["responded", "返信済みにする"], ["closed", "終了"]] : inquiry.status === "responded" ? [["closed", "終了"]] : []
          : inquiry.status === "closed" ? [] : [["closed", "問い合わせを終了"]];
        return `<article class="role-item" data-inquiry-id="${escapeHtml(inquiry.id)}"><div class="meta"><span>${escapeHtml(inquiryStatusLabels[inquiry.status] ?? inquiry.status)}</span><span>事業者ID: ${escapeHtml(inquiry.providerId)}</span></div><h3>${escapeHtml(inquiry.subject)}</h3><p>${escapeHtml(inquiry.message)}</p><div class="role-actions">${roleStatusButtons(actions)}</div></article>`;
      }).join("")
    : '<p class="empty">表示できる問い合わせはありません。</p>';
  document.querySelectorAll("[data-inquiry-id] .role-status-button").forEach((button) => {
    button.addEventListener("click", () => {
      const inquiryItem = button.closest("[data-inquiry-id]");
      if (inquiryItem?.dataset.inquiryId) void updateRoleStatus("inquiries", inquiryItem.dataset.inquiryId, button.dataset.status ?? "");
    });
  });
}

function renderNotifications(items) {
  state.notifications = items;
  elements.notificationList.innerHTML = items.length
    ? items.map((notification) => `<article class="role-item${notification.readAt ? "" : " unread"}" data-notification-id="${escapeHtml(notification.id)}"><div class="meta"><span>${notification.readAt ? "既読" : "未読"}</span><span>${escapeHtml(notification.createdAt.slice(0, 10))}</span></div><h3>${escapeHtml(notification.title)}</h3><p>${escapeHtml(notification.message)}</p>${notification.readAt ? "" : `<div class="role-actions"><button class="button ghost notification-read-button" data-notification-id="${escapeHtml(notification.id)}">既読にする</button></div>`}</article>`).join("")
    : '<p class="empty">新しい通知はありません。</p>';
  document.querySelectorAll(".notification-read-button").forEach((button) => {
    button.addEventListener("click", async () => {
      const notificationId = button.dataset.notificationId;
      if (!notificationId) return;
      try {
        await api(`/api/v1/notifications/${encodeURIComponent(notificationId)}`, { method: "PATCH", body: JSON.stringify({ read: true }) });
        await reloadRoleData();
      } catch (error) {
        setMessage(error.message);
      }
    });
  });
}

function renderApplications(items, page = {}, cursor = "") {
  state.applications = items;
  elements.applicationList.innerHTML = items.length
    ? items.map((application) => {
        const actions = state.role === "provider" && state.experience?.allowedActions.includes("application.status.update")
          ? application.status === "submitted" ? [["screening", "選考を開始"], ["closed", "終了"]] : application.status === "screening" ? [["closed", "終了"]] : []
          : [];
        return `<article class="role-item" data-application-id="${escapeHtml(application.id)}"><div class="meta"><span>${escapeHtml(applicationStatusLabels[application.status] ?? application.status)}</span></div><h3>${escapeHtml(application.message.slice(0, 80))}</h3><p>求人ID: ${escapeHtml(application.jobId)}</p><div class="role-actions">${roleStatusButtons(actions)}</div></article>`;
      }).join("")
    : '<p class="empty">表示できる応募はありません。</p>';
  document.querySelectorAll("[data-application-id] .role-status-button").forEach((button) => {
    button.addEventListener("click", () => {
      const applicationItem = button.closest("[data-application-id]");
      if (applicationItem?.dataset.applicationId) void updateRoleStatus("applications", applicationItem.dataset.applicationId, button.dataset.status ?? "");
    });
  });
  renderListPagination(elements.applicationPagination, page, cursor, reloadApplications, "応募一覧のページ移動");
}

async function updateRoleStatus(resource, resourceId, status) {
  if (!resourceId || !status) return;
  try {
    await api(`/api/v1/${resource}/${encodeURIComponent(resourceId)}`, { method: "PATCH", body: JSON.stringify({ status }) });
    setMessage("状態を更新しました。");
    await reload();
  } catch (error) {
    setMessage(error.message);
  }
}

function buildListQuery(values) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    const normalized = String(value ?? "").trim();
    if (normalized) params.set(key, normalized);
  });
  return params.toString();
}

async function reloadProviders(cursor = "") {
  const requestVersion = beginListRequest("providers", elements.providers);
  setListStatus(elements.providerStatus, "loading", "事業者一覧を読み込んでいます。");
  const query = buildListQuery({
    category: state.category,
    search: elements.search.value,
    theme: elements.providerTheme.value,
    location: elements.providerLocation.value,
    sort: elements.providerSort.value,
    cursor,
  });
  try {
    const body = await api(`/api/v1/providers?${query}`);
    if (isLatestListRequest("providers", requestVersion)) {
      renderProviders(body.items, body.page, cursor);
      setListStatus(elements.providerStatus);
    }
  } catch (error) {
    if (isLatestListRequest("providers", requestVersion)) {
      setListStatus(elements.providerStatus, "error", "事業者一覧を読み込めませんでした。再試行してください。", () => reloadProviders(cursor));
      throw error;
    }
  } finally {
    finishListRequest("providers", requestVersion, elements.providers);
  }
}

async function reloadDirectoryGuides() {
  const requestVersion = beginListRequest("directories", elements.directoryGuideList);
  elements.directoryGuidePanel.hidden = false;
  setListStatus(elements.directoryGuideStatus, "loading", "カテゴリ別の外部案内を読み込んでいます。");
  try {
    const body = await api(`/api/v1/categories/${encodeURIComponent(state.category)}/directories`);
    if (isLatestListRequest("directories", requestVersion)) {
      renderDirectoryGuides(body.items);
      setListStatus(elements.directoryGuideStatus);
    }
  } catch (error) {
    if (isLatestListRequest("directories", requestVersion)) {
      setListStatus(elements.directoryGuideStatus, "error", "外部案内を読み込めませんでした。再試行してください。", () => reloadDirectoryGuides());
      throw error;
    }
  } finally {
    finishListRequest("directories", requestVersion, elements.directoryGuideList);
  }
}

async function reloadRequests(cursor = "") {
  const requestVersion = beginListRequest("requests", elements.requestList);
  setListStatus(elements.requestStatusMessage, "loading", "依頼一覧を読み込んでいます。");
  const query = buildListQuery({
    search: elements.requestSearch.value,
    status: elements.requestStatus.value,
    sort: elements.requestSort.value,
    cursor,
  });
  try {
    const body = await api(`/api/v1/requests?${query}`);
    if (isLatestListRequest("requests", requestVersion)) {
      renderRequests(body.items, body.page, cursor);
      setListStatus(elements.requestStatusMessage);
    }
  } catch (error) {
    if (isLatestListRequest("requests", requestVersion)) {
      setListStatus(elements.requestStatusMessage, "error", "依頼一覧を読み込めませんでした。再試行してください。", () => reloadRequests(cursor));
      throw error;
    }
  } finally {
    finishListRequest("requests", requestVersion, elements.requestList);
  }
}

async function reloadApplications(cursor = "") {
  const requestVersion = beginListRequest("applications", elements.applicationList);
  setListStatus(elements.applicationStatusMessage, "loading", "応募一覧を読み込んでいます。");
  const query = buildListQuery({
    search: elements.applicationSearch.value,
    jobId: elements.applicationJob.value,
    status: elements.applicationStatus.value,
    sort: elements.applicationSort.value,
    cursor,
  });
  try {
    const body = await api(`/api/v1/applications?${query}`);
    if (isLatestListRequest("applications", requestVersion)) {
      renderApplications(body.items, body.page, cursor);
      setListStatus(elements.applicationStatusMessage);
    }
  } catch (error) {
    if (isLatestListRequest("applications", requestVersion)) {
      setListStatus(elements.applicationStatusMessage, "error", "応募一覧を読み込めませんでした。再試行してください。", () => reloadApplications(cursor));
      throw error;
    }
  } finally {
    finishListRequest("applications", requestVersion, elements.applicationList);
  }
}

async function reloadJobs(cursor = "") {
  if (elements.jobPanel.hidden) {
    clearJobView();
    return;
  }
  const requestVersion = beginListRequest("jobs", elements.jobs);
  setListStatus(elements.jobStatusMessage, "loading", "求人一覧を読み込んでいます。");
  const query = buildListQuery({
    category: state.category,
    search: elements.jobSearch.value,
    employmentType: elements.jobEmployment.value,
    location: elements.jobLocation.value,
    status: elements.jobStatus.value,
    sort: elements.jobSort.value,
    cursor,
  });
  try {
    const body = await api(`/api/v1/jobs?${query}`);
    if (isLatestListRequest("jobs", requestVersion)) {
      renderJobs(body.items, body.page, cursor);
      setListStatus(elements.jobStatusMessage);
    }
  } catch (error) {
    if (isLatestListRequest("jobs", requestVersion)) {
      setListStatus(elements.jobStatusMessage, "error", "求人一覧を読み込めませんでした。再試行してください。", () => reloadJobs(cursor));
      throw error;
    }
  } finally {
    finishListRequest("jobs", requestVersion, elements.jobs);
  }
}

function clearJobView() {
  invalidateListRequest("jobs", elements.jobs, elements.jobStatusMessage);
  elements.jobs.innerHTML = "";
  elements.jobPagination.replaceChildren();
}

async function reloadRoleData() {
  const canSeeRequests = Boolean(state.token && (state.role === "orderer" || state.role === "provider"));
  const canSeeApplications = Boolean(state.token && (state.role === "candidate" || state.role === "provider"));
  const canSeeInquiries = Boolean(state.token && state.experience?.allowedActions.includes("inquiry.read"));
  const canSeeNotifications = Boolean(state.token && state.experience?.allowedActions.includes("notification.read"));
  elements.requestInboxPanel.hidden = !canSeeRequests;
  elements.applicationPanel.hidden = !canSeeApplications;
  elements.inquiryStatusPanel.hidden = !canSeeInquiries || state.role === "provider";
  elements.inquiryManagementPanel.hidden = !canSeeInquiries || state.role !== "provider";
  elements.notificationPanel.hidden = !canSeeNotifications;
  if (!canSeeRequests) {
    invalidateListRequest("requests", elements.requestList, elements.requestStatusMessage);
    elements.requestList.innerHTML = "";
    elements.requestPagination.replaceChildren();
  }
  if (!canSeeApplications) {
    invalidateListRequest("applications", elements.applicationList, elements.applicationStatusMessage);
    elements.applicationList.innerHTML = "";
    elements.applicationPagination.replaceChildren();
  }
  if (!canSeeInquiries) {
    elements.inquiryList.innerHTML = "";
    elements.inquiryManagementList.innerHTML = "";
  }
  if (!canSeeNotifications) elements.notificationList.innerHTML = "";

  if (canSeeRequests) {
    try {
      await reloadRequests();
    } catch (error) {
      setMessage(error.message);
    }
  }
  if (canSeeApplications) {
    try {
      await reloadApplications();
    } catch (error) {
      setMessage(error.message);
    }
  }
  if (canSeeInquiries) {
    try {
      const body = await api("/api/v1/inquiries");
      renderInquiries(body.items);
    } catch (error) {
      setMessage(error.message);
    }
  }
  if (canSeeNotifications) {
    try {
      const body = await api("/api/v1/notifications?limit=50");
      renderNotifications(body.items);
    } catch (error) {
      setMessage(error.message);
    }
  }
}

function setProviderManagementMessage(message = "") {
  elements.providerManagementMessage.textContent = message;
}

function setJobManagementMessage(message = "") {
  elements.jobManagementMessage.textContent = message;
}

async function reloadProviderManagement() {
  const canManage = Boolean(
    state.token
      && state.role === "provider"
      && state.principal?.providerId
      && state.experience?.allowedActions.includes("listing.update"),
  );
  elements.providerManagementPanel.hidden = !canManage;
  elements.jobManagementPanel.hidden = !Boolean(state.token && state.role === "provider" && state.experience?.allowedActions.includes("job.manage"));
  elements.listingSubmitButton.hidden = true;
  elements.listingStatus.textContent = "";
  if (!canManage) return;
  try {
    const body = await api(`/api/v1/providers/${encodeURIComponent(state.principal.providerId)}`);
    const nameField = elements.providerManagementForm.querySelector('[name="name"]');
    const themesField = elements.providerManagementForm.querySelector('[name="themes"]');
    const locationField = elements.providerManagementForm.querySelector('[name="location"]');
    const publicFieldsField = elements.providerManagementForm.querySelector('[name="publicFields"]');
    if (nameField) nameField.value = body.item.name;
    if (themesField) themesField.value = body.item.themes.join(", ");
    if (locationField) locationField.value = body.item.location;
    if (publicFieldsField) publicFieldsField.value = "";
    const listingStatusLabels = { draft: "下書き", pending_review: "審査中", published: "公開中", suspended: "停止中" };
    const status = body.item.listingStatus ?? "published";
    elements.listingStatus.textContent = `掲載状態: ${listingStatusLabels[status] ?? status}${body.item.listingReviewNote ? ` / 審査メモ: ${body.item.listingReviewNote}` : ""}`;
    elements.listingSubmitButton.hidden = !state.experience?.allowedActions.includes("listing.submit") || status === "pending_review";
    setProviderManagementMessage("");
  } catch (error) {
    setProviderManagementMessage(error.message);
  }
}

function renderJobs(items, page = {}, cursor = "") {
  const canManageJobs = state.role === "provider" && state.experience?.allowedActions.includes("job.manage");
  elements.jobs.innerHTML = items.length
    ? items.map((job) => `<article class="job-item"><h3>${escapeHtml(job.title)}</h3><div class="meta"><span>${escapeHtml(job.employmentType)}</span><span>${escapeHtml(job.location)}</span></div>${state.experience?.allowedActions.includes("application.create") ? `<button class="button ghost apply-button" data-job-id="${escapeHtml(job.id)}">この求人に応募</button>` : ""}</article>`).join("")
    : '<p class="empty">公開求人がありません。</p>';
  document.querySelectorAll(".job-item").forEach((item, index) => {
    const job = items[index];
    if (!job) return;
    const meta = item.querySelector(".meta");
    if (meta) {
      const status = document.createElement("span");
      status.className = "status-tag";
      status.textContent = job.status === "published" ? "公開中" : "終了";
      meta.append(status);
    }
    if (canManageJobs) {
      const button = document.createElement("button");
      button.className = "button ghost job-status-button";
      button.dataset.jobId = job.id;
      button.dataset.nextStatus = job.status === "published" ? "closed" : "published";
      button.textContent = job.status === "published" ? "求人を終了" : "再公開";
      item.append(button);
    }
  });
  document.querySelectorAll(".job-status-button").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await api(`/api/v1/jobs/${encodeURIComponent(button.dataset.jobId ?? "")}`, {
          method: "PATCH",
          body: JSON.stringify({ status: button.dataset.nextStatus }),
        });
        setMessage("求人の状態を更新しました。");
        await reload();
      } catch (error) {
        setMessage(error.message);
      }
    });
  });
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
  renderListPagination(elements.jobPagination, page, cursor, reloadJobs, "求人一覧のページ移動");
}

function renderProposals(items) {
  state.proposals = items;
  elements.proposals.innerHTML = items.length
    ? items.map((proposal) => `<article class="editor-item"><div class="meta"><span>${escapeHtml(proposal.audience)}</span><span>${escapeHtml(proposal.contentType)}</span></div><h3>${escapeHtml(proposal.topic)}</h3><p>${escapeHtml(proposal.searchIntent)}</p><button class="button ghost draft-button" data-proposal-id="${escapeHtml(proposal.id)}">下書きを生成</button></article>`).join("")
    : '<p class="empty">企画案がまだありません。</p>';
  document.querySelectorAll(".draft-button").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await api("/api/v1/content/drafts", { method: "POST", body: JSON.stringify({ proposalId: button.dataset.proposalId }) });
        setContentMessage("対象ポジション別の下書きを作成しました。");
        await reloadContent();
      } catch (error) {
        setContentMessage(error.message);
      }
    });
  });
}

function renderContents(items) {
  state.contents = items;
  elements.contents.innerHTML = items.length
    ? items.map((content) => `<article class="editor-item"><div class="meta"><span>${escapeHtml(content.status)}</span><span>v${escapeHtml(content.version)}</span></div><h3>${escapeHtml(content.title)}</h3><p>${escapeHtml(content.summary)}</p><div class="editor-actions"><button class="button ghost content-action" data-action="preview" data-content-id="${escapeHtml(content.id)}">本文を見る</button>${content.status !== "approved" && content.status !== "published" ? `<button class="button ghost content-action" data-action="fact" data-content-id="${escapeHtml(content.id)}">事実確認</button>` : ""}${content.status === "drafted" || content.status === "polished" ? `<button class="button ghost content-action" data-action="polish" data-content-id="${escapeHtml(content.id)}">清書</button>` : ""}${content.status === "polished" || content.status === "seo_reviewed" ? `<button class="button ghost content-action" data-action="audit" data-content-id="${escapeHtml(content.id)}">SEO監査</button>` : ""}${content.status === "seo_reviewed" ? `<button class="button primary content-action" data-action="approve" data-content-id="${escapeHtml(content.id)}">承認</button>` : ""}${content.status === "approved" ? `<button class="button primary content-action" data-action="build" data-content-id="${escapeHtml(content.id)}">静的ビルド</button>` : ""}</div></article>`).join("")
    : '<p class="empty">下書きがまだありません。</p>';
  document.querySelectorAll(".content-action").forEach((button) => {
    button.addEventListener("click", () => handleContentAction(button.dataset.action, button.dataset.contentId));
  });
}

const publicationStatusLabels = { built: "ビルド済み", deployed: "デプロイ済み", published: "公開済み", rolled_back: "ロールバック済み" };

function renderPublicationHistory(items) {
  elements.publicationHistory.innerHTML = items.length
    ? items.map((item) => {
        const canRollback = item.status === "deployed" || item.status === "published";
        return `<article class="editor-item"><div class="meta"><span>${escapeHtml(publicationStatusLabels[item.status] ?? item.status)}</span><span>${escapeHtml(item.updatedAt.slice(0, 10))}</span><span>${escapeHtml(String(item.fileCount))}ファイル</span></div><h4>${escapeHtml(item.id)}</h4><p>${escapeHtml(item.baseUrl)} · コンテンツ ${escapeHtml(String(item.contentIds.length))}件</p>${canRollback ? `<button class="button ghost publication-rollback-button" data-publication-id="${escapeHtml(item.id)}">この履歴へロールバック</button>` : ""}</article>`;
      }).join("")
    : '<p class="empty">公開履歴がまだありません。</p>';
  document.querySelectorAll(".publication-rollback-button").forEach((button) => {
    button.addEventListener("click", () => handlePublicationRollback(button.dataset.publicationId));
  });
}

async function reloadPublicationHistory() {
  const visible = state.token && state.role === "provider" && state.experience?.allowedActions.includes("publication.history");
  if (!visible) {
    elements.publicationHistory.innerHTML = "";
    return;
  }
  try {
    const body = await api("/api/v1/publications");
    renderPublicationHistory(body.items);
  } catch (error) {
    elements.publicationHistory.innerHTML = `<p class="empty">${escapeHtml(error.message)}</p>`;
  }
}

async function handlePublicationRollback(publicationId) {
  if (!publicationId) return;
  try {
    await api(`/api/v1/publications/${encodeURIComponent(publicationId)}/rollback`, { method: "POST", body: JSON.stringify({}) });
    setContentMessage("公開履歴をロールバックしました。");
    await reloadPublicationHistory();
  } catch (error) {
    setContentMessage(error.message);
  }
}

async function reloadContent() {
  const visible = state.token && state.role === "provider" && state.experience?.allowedActions.includes("content.propose");
  elements.contentPanel.hidden = !visible;
  if (!visible) return;
  const proposals = await api("/api/v1/content/proposals");
  const contents = await api("/api/v1/content");
  renderProposals(proposals.items);
  renderContents(contents.items);
  await reloadPublicationHistory();
}

async function handleContentAction(action, contentId) {
  if (!contentId) return;
  try {
    if (action === "preview") {
      const body = await api(`/api/v1/content/${encodeURIComponent(contentId)}`);
      elements.contentPreview.hidden = false;
      elements.contentPreview.textContent = body.item.body;
      return;
    }
    if (action === "polish") {
      const instructions = window.prompt("清書方針（任意）") ?? "";
      await api(`/api/v1/content/${encodeURIComponent(contentId)}/polish`, { method: "POST", body: JSON.stringify({ instructions }) });
      setContentMessage("清書しました。SEO監査へ進めます。");
    } else if (action === "fact") {
      const body = await api(`/api/v1/content/${encodeURIComponent(contentId)}/fact-check`, { method: "POST" });
      setContentMessage(body.item.passed ? "一次情報の登録を確認しました。" : `事実確認の指摘: ${body.item.issues.join(" ")}`);
    } else if (action === "audit") {
      const body = await api(`/api/v1/content/${encodeURIComponent(contentId)}/seo-audit`, { method: "POST" });
      setContentMessage(`SEO監査スコア: ${body.item.score} / 100（指摘 ${body.item.issues.length}件）`);
    } else if (action === "approve") {
      await api(`/api/v1/content/${encodeURIComponent(contentId)}/approve`, { method: "POST" });
      setContentMessage("人間の確認済みとして承認しました。");
    } else if (action === "build") {
      const body = await api("/api/v1/publications/build", { method: "POST", body: JSON.stringify({ contentIds: [contentId], baseUrl: window.location.origin }) });
      setContentMessage(`静的ビルド完了: ${body.item.files.length}ファイル。BuilderOS Adapterへ渡せます。`);
    }
    await reloadContent();
  } catch (error) {
    setContentMessage(error.message);
  }
}

async function reload() {
  const contextBody = await api(`/api/v1/categories/${encodeURIComponent(state.category)}`);
  renderExperience(contextBody.item.experience, contextBody.item.navigation);
  await reloadProviderManagement();
  await reloadRoleData();
  await reloadProviders();
  renderDirectoryGuides(contextBody.item.directoryGuides);
  setListStatus(elements.directoryGuideStatus);
  await reloadJobs();
  elements.session.textContent = state.token ? `${labels[state.role]} / ${state.category}` : "未ログイン";
  await reloadContent();
}

async function login() {
  try {
    const body = await api("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: elements.email.value.trim(), password: elements.password.value, category: state.category, role: elements.role.value }),
    });
    if (finishLogin(body)) {
      setMessage(`${labels[state.role]}としてログインしました。`);
      await reload();
    }
  } catch (error) {
    setMessage(error.message);
  }
}

async function loginWithOidc() {
  try {
    const body = await api("/api/v1/auth/oidc/start", {
      method: "POST",
      body: JSON.stringify({ category: state.category, role: elements.role.value }),
    });
    window.location.assign(body.item.authorizationUrl);
  } catch (error) {
    setMessage(error.message);
  }
}

async function completeOidcCallback() {
  const params = new URLSearchParams(window.location.search);
  const stateParam = params.get("state");
  const code = params.get("code");
  if (!stateParam || !code) return false;
  try {
    const body = await api(`/api/v1/auth/oidc/callback?state=${encodeURIComponent(stateParam)}&code=${encodeURIComponent(code)}`);
    window.history.replaceState({}, document.title, window.location.pathname);
    if (finishLogin(body.item)) {
      setMessage(`${labels[state.role]}としてログインしました。`);
      return true;
    }
    return true;
  } catch (error) {
    window.history.replaceState({}, document.title, window.location.pathname);
    setMessage(error.message);
    return false;
  }
}

async function completeMfa() {
  if (!state.mfaChallengeToken) return;
  try {
    const body = await api("/api/v1/auth/mfa/complete", {
      method: "POST",
      body: JSON.stringify({ challengeToken: state.mfaChallengeToken, code: elements.mfaCode.value.trim() }),
    });
    if (finishLogin(body)) {
      setMessage(`${labels[state.role]}としてログインしました。`);
      await reload();
    }
  } catch (error) {
    setMessage(error.message);
  }
}

async function logout() {
  try { await api("/api/v1/auth/logout", { method: "POST" }); } catch {}
  state.token = null;
  state.principal = null;
  state.mfaChallengeToken = null;
  state.role = "user";
  updateAuthUi();
  elements.mfaPanel.hidden = true;
  elements.loginForm.hidden = !state.authCapabilities.passwordLogin;
  elements.oidc.hidden = !state.authCapabilities.oidcLogin;
  elements.logout.hidden = true;
  setMessage("ログアウトしました。");
  await reload();
}

elements.category.addEventListener("change", async () => {
  if (state.token) {
    try { await api("/api/v1/auth/logout", { method: "POST" }); } catch {}
    state.token = null;
    state.principal = null;
    state.mfaChallengeToken = null;
    state.role = "user";
    elements.mfaPanel.hidden = true;
    updateAuthUi();
    elements.logout.hidden = true;
  }
  state.category = elements.category.value;
  try { await reload(); } catch (error) { setMessage(error.message); }
});
function bindListFilters(controls, reloadFunction) {
  let timerId = 0;
  controls.forEach((control) => {
    if (!control) return;
    const eventName = control.tagName === "SELECT" ? "change" : "input";
    control.addEventListener(eventName, () => {
      window.clearTimeout(timerId);
      timerId = window.setTimeout(() => {
        void reloadFunction().catch((error) => setMessage(error.message));
      }, eventName === "input" ? 180 : 0);
    });
  });
}

bindListFilters([elements.search, elements.providerTheme, elements.providerLocation, elements.providerSort], reloadProviders);
bindListFilters([elements.requestSearch, elements.requestStatus, elements.requestSort], reloadRequests);
bindListFilters([elements.applicationSearch, elements.applicationJob, elements.applicationStatus, elements.applicationSort], reloadApplications);
bindListFilters([elements.jobSearch, elements.jobEmployment, elements.jobLocation, elements.jobStatus, elements.jobSort], reloadJobs);
elements.loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void login();
});
elements.oidc.addEventListener("click", () => void loginWithOidc());
elements.mfaForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void completeMfa();
});
elements.account.addEventListener("change", () => {
  elements.email.value = elements.account.value;
});
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

elements.inquiryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(elements.inquiryForm);
  try {
    await api("/api/v1/inquiries", {
      method: "POST",
      body: JSON.stringify({
        category: state.category,
        providerId: form.get("providerId"),
        subject: form.get("subject"),
        message: form.get("message"),
      }),
    });
    elements.inquiryForm.reset();
    setMessage("問い合わせを送信しました。");
    await reloadRoleData();
  } catch (error) {
    setMessage(error.message);
  }
});

elements.providerManagementForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.principal?.providerId) return;
  const form = new FormData(elements.providerManagementForm);
  const rawPublicFields = String(form.get("publicFields") ?? "").trim();
  try {
    const publicFields = rawPublicFields ? JSON.parse(rawPublicFields) : undefined;
    if (publicFields !== undefined && (!publicFields || typeof publicFields !== "object" || Array.isArray(publicFields))) {
      throw new Error("公開項目はJSONオブジェクトで指定してください。");
    }
    await api(`/api/v1/providers/${encodeURIComponent(state.principal.providerId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: form.get("name"),
        themes: String(form.get("themes") ?? "").split(",").map((theme) => theme.trim()).filter(Boolean),
        location: form.get("location"),
        ...(publicFields !== undefined ? { publicFields } : {}),
      }),
    });
    setProviderManagementMessage("掲載情報を保存しました。");
    await reload();
  } catch (error) {
    setProviderManagementMessage(error.message);
  }
});

elements.listingSubmitButton.addEventListener("click", async () => {
  if (!state.principal?.providerId) return;
  try {
    await api(`/api/v1/providers/${encodeURIComponent(state.principal.providerId)}/listing-submission`, { method: "POST" });
    setProviderManagementMessage("掲載審査へ送信しました。審査完了まで公開検索からは除外されます。");
    await reload();
  } catch (error) {
    setProviderManagementMessage(error.message);
  }
});

elements.jobManagementForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(elements.jobManagementForm);
  try {
    await api("/api/v1/jobs", {
      method: "POST",
      body: JSON.stringify({
        category: state.category,
        title: form.get("title"),
        employmentType: form.get("employmentType"),
        location: form.get("location"),
        description: form.get("description"),
        status: form.get("status"),
      }),
    });
    elements.jobManagementForm.reset();
    setJobManagementMessage("求人を作成しました。");
    await reload();
  } catch (error) {
    setJobManagementMessage(error.message);
  }
});

elements.contentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(elements.contentForm);
  try {
    await api("/api/v1/content/proposals", {
      method: "POST",
      body: JSON.stringify({
        category: state.category,
        contentType: form.get("contentType"),
        audience: form.get("audience"),
        topic: form.get("topic"),
        primaryKeyword: form.get("primaryKeyword"),
        sourceFacts: String(form.get("sourceFacts") ?? "").split("\n").map((fact) => fact.trim()).filter(Boolean),
      }),
    });
    elements.contentForm.reset();
    setContentMessage("企画案を作成しました。");
    await reloadContent();
  } catch (error) {
    setContentMessage(error.message);
  }
});

async function initialize() {
  await loadAuthConfig();
  await completeOidcCallback();
  await reload();
}

initialize().catch((error) => setMessage(error.message));
