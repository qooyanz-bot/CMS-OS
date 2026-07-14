const state = {
  token: null,
  mfaChallengeToken: null,
  principal: null,
  category: "legal",
  role: "user",
  categories: [],
  availableContexts: [],
  authCapabilities: { passwordLogin: true, oidcLogin: false, mfaEnrollment: false },
  experience: null,
  providers: [],
  favorites: [],
  providerProfile: null,
  compareProviderIds: [],
  providerComparison: [],
  directoryGuides: [],
  requests: [],
  bookings: [],
  applications: [],
  inquiries: [],
  notifications: [],
  proposals: [],
  contents: [],
  mediaAssets: [],
};

const listRequestVersions = {
  providers: 0,
  requests: 0,
  applications: 0,
  jobs: 0,
  directories: 0,
  media: 0,
};

const labels = {
  user: "ユーザー",
  orderer: "発注者",
  provider: "事業者",
  candidate: "リクルーター",
  recruiter: "リクルーター",
};

const defaultRoleOptions = ["user", "orderer", "provider", "recruiter"];
const providerCompareLimit = 3;

function isRecruiterRole(role) {
  return role === "candidate" || role === "recruiter";
}

const moduleLabels = {
  aiUseCases: "AI活用事例",
  automationRequest: "業務自動化相談",
  aiSolutionManagement: "AIソリューション管理",
  aiCareer: "AI人材キャリア",
  talentGuide: "人材不足対策ガイド",
  recruitmentRequest: "採用課題相談",
  recruitmentManagement: "採用支援管理",
  careerSupport: "キャリア支援",
  destinationGuide: "観光・地域ガイド",
  travelPlanning: "旅行・誘客プランニング",
  tourismExperienceManagement: "観光体験管理",
  hospitalityJobs: "観光業求人",
  mobilityGuide: "モビリティ活用ガイド",
  fleetRequest: "車両・移動課題相談",
  fleetManagement: "フリート管理",
  mobilityCareer: "モビリティキャリア",
  decarbonizationGuide: "脱炭素ガイド",
  gxPlanning: "GX導入プランニング",
  gxManagement: "GX事業管理",
  sustainabilityCareer: "サステナビリティキャリア",
  regionalGuide: "地域活性化ガイド",
  regionalProject: "地域プロジェクト相談",
  regionalProjectManagement: "地域事業管理",
  communityCareer: "地域共創キャリア",
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

const navigationAnchorTargets = {
  themes: "provider-discovery",
  menus: "provider-discovery",
  providers: "provider-discovery",
  guides: "directory-guide-panel",
  styles: "directory-guide-panel",
  jobs: "job-panel",
  requests: "request-panel",
  bookings: "booking-panel",
  applications: "application-panel",
  providerDashboard: "provider-management-panel",
  listingManagement: "provider-management-panel",
  inquiryManagement: "inquiry-management-panel",
  menuManagement: "provider-management-panel",
  bookingManagement: "booking-status-panel",
  styleManagement: "provider-management-panel",
  jobManagement: "job-management-panel",
  contentAssistant: "content-editor-panel",
  seoAssistant: "content-editor-panel",
};

function resolveNavigationTarget(id) {
  if (id === "requests" && state.role === "provider") return "request-inbox-panel";
  if (id === "bookings" && state.role === "provider") return "booking-status-panel";
  return navigationAnchorTargets[id];
}

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
  navigation: document.querySelector("#experience-navigation"),
  workflowTitle: document.querySelector("#workflow-title"),
  workflowCopy: document.querySelector("#workflow-copy"),
  workflowOne: document.querySelector("#workflow-step-one"),
  workflowTwo: document.querySelector("#workflow-step-two"),
  workflowThree: document.querySelector("#workflow-step-three"),
  providerSectionTitle: document.querySelector("#provider-section-title"),
  directoryGuideTitle: document.querySelector("#directory-guide-title"),
  jobPanelTitle: document.querySelector("#job-panel-title"),
  search: document.querySelector("#provider-search"),
  providerTheme: document.querySelector("#provider-theme-filter"),
  providerThemeOptions: document.querySelector("#provider-theme-options"),
  providerLocation: document.querySelector("#provider-location-filter"),
  providerSort: document.querySelector("#provider-sort"),
  providers: document.querySelector("#provider-list"),
  providerProfilePanel: document.querySelector("#provider-profile-panel"),
  providerProfileName: document.querySelector("#provider-profile-name"),
  providerProfileSummary: document.querySelector("#provider-profile-summary"),
  providerProfileMeta: document.querySelector("#provider-profile-meta"),
  providerProfileFields: document.querySelector("#provider-profile-fields"),
  providerProfileClose: document.querySelector("#provider-profile-close"),
  providerProfileRequest: document.querySelector("#provider-profile-request"),
  providerProfileBooking: document.querySelector("#provider-profile-booking"),
  providerProfileInquiry: document.querySelector("#provider-profile-inquiry"),
  providerProfileStatus: document.querySelector("#provider-profile-status"),
  providerPagination: document.querySelector("#provider-pagination"),
      providerStatus: document.querySelector("#provider-list-status"),
  favoritePanel: document.querySelector("#favorite-panel"),
  favorites: document.querySelector("#favorite-list"),
  favoriteStatus: document.querySelector("#favorite-list-status"),
  providerComparePanel: document.querySelector("#provider-compare-panel"),
  providerCompareRun: document.querySelector("#provider-compare-run"),
  providerCompareClear: document.querySelector("#provider-compare-clear"),
  providerCompareList: document.querySelector("#provider-compare-list"),
  providerCompareStatus: document.querySelector("#provider-compare-status"),
  directoryGuidePanel: document.querySelector("#directory-guide-panel"),
  directoryGuideList: document.querySelector("#directory-guide-list"),
  directoryGuideStatus: document.querySelector("#directory-guide-status"),
  requestPanel: document.querySelector("#request-panel"),
  requestForm: document.querySelector("#request-form"),
  requestProvider: document.querySelector("#request-provider"),
  bookingPanel: document.querySelector("#booking-panel"),
  bookingForm: document.querySelector("#booking-form"),
  bookingProvider: document.querySelector("#booking-provider"),
  bookingMessage: document.querySelector("#booking-message"),
  bookingStatusPanel: document.querySelector("#booking-status-panel"),
  bookingStatusFilter: document.querySelector("#booking-status-filter"),
  bookingList: document.querySelector("#booking-list"),
  bookingStatusMessage: document.querySelector("#booking-list-status"),
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
  contentVersions: document.querySelector("#content-version-list"),
  contentReviews: document.querySelector("#content-review-list"),
  publicationHistory: document.querySelector("#publication-history-list"),
  publicationSchedulePanel: document.querySelector("#publication-schedule-panel"),
  publicationScheduleList: document.querySelector("#publication-schedule-list"),
  siteSeoAuditButton: document.querySelector("#site-seo-audit-button"),
  siteSeoAuditResult: document.querySelector("#site-seo-audit-result"),
  contentPreview: document.querySelector("#content-preview"),
  providerManagementPanel: document.querySelector("#provider-management-panel"),
  providerManagementForm: document.querySelector("#provider-management-form"),
  providerManagementMessage: document.querySelector("#provider-management-message"),
  listingStatus: document.querySelector("#listing-status"),
  listingSubmitButton: document.querySelector("#listing-submit-button"),
  portalPlanningPanel: document.querySelector("#portal-planning-panel"),
  portalPlanningForm: document.querySelector("#portal-planning-form"),
  portalPlanningMessage: document.querySelector("#portal-planning-message"),
  portalPlanResult: document.querySelector("#portal-plan-result"),
  portalPlanList: document.querySelector("#portal-plan-list"),
  jobManagementPanel: document.querySelector("#job-management-panel"),
  jobManagementForm: document.querySelector("#job-management-form"),
  jobManagementMessage: document.querySelector("#job-management-message"),
  mediaManagementPanel: document.querySelector("#media-management-panel"),
  mediaManagementForm: document.querySelector("#media-management-form"),
  mediaManagementMessage: document.querySelector("#media-management-message"),
  mediaSeoAuditButton: document.querySelector("#media-seo-audit-button"),
  mediaSeoAuditResult: document.querySelector("#media-seo-audit-result"),
  mediaList: document.querySelector("#media-list"),
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
  if (!response.ok) {
    const error = new Error(body.error ?? "操作に失敗しました。");
    error.status = response.status;
    throw error;
  }
  return body;
}

function updateAuthUi() {
  elements.loginForm.hidden = !state.authCapabilities.passwordLogin;
  elements.oidc.hidden = !state.authCapabilities.oidcLogin;
  elements.demoPanel.hidden = !state.authCapabilities.passwordLogin;
  elements.password.required = state.authCapabilities.passwordLogin;
}

function contextForCategory(category) {
  return state.availableContexts.find((context) => context.category === category);
}

function renderCategoryOptions() {
  const categories = state.token && state.availableContexts.length > 0
    ? state.categories.filter((category) => contextForCategory(category.slug))
    : state.categories;
  if (categories.length === 0) return;
  const selectedCategory = categories.some((category) => category.slug === state.category) ? state.category : categories[0].slug;
  elements.category.replaceChildren(...categories.map((category) => {
    const option = document.createElement("option");
    option.value = category.slug;
    option.textContent = category.label;
    return option;
  }));
  state.category = selectedCategory;
  elements.category.value = selectedCategory;
}

function renderRoleOptions() {
  const context = state.token ? contextForCategory(state.category) : undefined;
  const roles = context?.roles?.filter((role) => labels[role]) ?? defaultRoleOptions;
  const selectedRole = roles.includes(state.role) ? state.role : roles[0] ?? "user";
  elements.role.replaceChildren(...roles.map((role) => {
    const option = document.createElement("option");
    option.value = role;
    option.textContent = labels[role];
    return option;
  }));
  state.role = selectedRole;
  elements.role.value = selectedRole;
}

function applyPrincipal(principal) {
  const normalizedRole = principal.role === "candidate" ? "recruiter" : principal.role;
  state.principal = normalizedRole === principal.role ? principal : { ...principal, role: normalizedRole };
  state.category = principal.category;
  state.role = normalizedRole;
  state.availableContexts = Array.isArray(principal.availableContexts) ? principal.availableContexts : [];
  renderCategoryOptions();
  renderRoleOptions();
}

async function loadCategories() {
  const body = await api("/api/v1/categories");
  const categories = Array.isArray(body.items)
    ? body.items.filter((item) => item && typeof item.slug === "string" && item.slug.trim() && typeof item.label === "string" && item.label.trim())
    : [];
  if (categories.length === 0) throw new Error("利用可能なカテゴリを取得できませんでした。");
  state.categories = categories;
  renderCategoryOptions();
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
  state.mfaChallengeToken = null;
  applyPrincipal(result.principal);
  elements.mfaPanel.hidden = true;
  elements.loginForm.hidden = true;
  elements.oidc.hidden = true;
  elements.demoPanel.hidden = true;
  elements.logout.hidden = false;
  return true;
}

function clearSessionState() {
  state.token = null;
  state.principal = null;
  state.mfaChallengeToken = null;
  state.role = "user";
  state.availableContexts = [];
  state.favorites = [];
  state.compareProviderIds = [];
  state.providerComparison = [];
  state.bookings = [];
  clearProviderProfile();
  clearProviderComparison();
  renderCategoryOptions();
  renderRoleOptions();
  elements.mfaPanel.hidden = true;
  updateAuthUi();
  elements.logout.hidden = true;
  elements.favoritePanel.hidden = true;
  elements.favorites.replaceChildren();
  elements.bookingList.replaceChildren();
  elements.bookingStatusPanel.hidden = true;
  elements.bookingMessage.textContent = "";
}

function formatValue(value) {
  if (Array.isArray(value)) return value.map(escapeHtml).join(" / ");
  return escapeHtml(value);
}

function renderExperience(experience, navigation = [], themeOptions = []) {
  state.experience = experience;
  elements.title.textContent = experience.categoryLabel;
  elements.badge.textContent = labels[experience.role];
  elements.notice.textContent = experience.notices.join(" ");
  const navigationLabels = Object.fromEntries(navigation.map((item) => [item.id, item.label]));
  const primaryLabel = navigationLabels.themes ?? navigationLabels.menus ?? "テーマ";
  const providerLabel = navigationLabels.providers ?? "事業者を探す";
  const guideLabel = navigationLabels.guides ?? navigationLabels.styles ?? "外部案内";
  const jobLabel = navigationLabels.jobs ?? "求人";
  elements.modules.innerHTML = experience.visibleModules
    .map((module) => `<span>${escapeHtml(moduleLabels[module] ?? navigationLabels[module] ?? module)}</span>`)
    .join("");
  elements.navigation.replaceChildren();
  for (const item of Array.isArray(navigation) ? navigation : []) {
    const targetId = resolveNavigationTarget(item.id);
    if (!targetId || !document.getElementById(targetId)) continue;
    const link = document.createElement("a");
    link.href = `#${targetId}`;
    link.textContent = item.label;
    link.dataset.navigationId = item.id;
    elements.navigation.append(link);
  }
  elements.navigation.hidden = elements.navigation.childElementCount === 0;

  const actionLabel = experience.visibleModules.includes("booking")
    ? "予約する"
    : experience.allowedActions.includes("request.create")
      ? "依頼する"
      : experience.allowedActions.includes("inquiry.create")
        ? "問い合わせる"
        : "探す";
  elements.workflowTitle.textContent = `${primaryLabel}から${actionLabel}`;
  elements.workflowCopy.textContent = `${primaryLabel}、${providerLabel}、地域を確認し、目的に合う${providerLabel}へつなげます。`;
  elements.workflowOne.textContent = `${primaryLabel}を選ぶ`;
  elements.workflowTwo.textContent = `${providerLabel}を比較する`;
  elements.workflowThree.textContent = actionLabel;
  elements.providerSectionTitle.textContent = providerLabel;
  elements.directoryGuideTitle.textContent = `${guideLabel}の外部案内`;
  elements.jobPanelTitle.textContent = `カテゴリの${jobLabel}`;
  elements.search.placeholder = `${providerLabel}名・${primaryLabel}・地域`;
  elements.providerTheme.placeholder = `${primaryLabel}を指定`;
  elements.providerThemeOptions.replaceChildren(...(Array.isArray(themeOptions) ? themeOptions : []).map((theme) => {
    const option = document.createElement("option");
    option.value = theme;
    return option;
  }));
  elements.requestPanel.hidden = !experience.allowedActions.includes("request.create");
  const canCreateBooking = experience.allowedActions.includes("booking.create");
  elements.bookingPanel.hidden = !canCreateBooking;
  if (!canCreateBooking) {
    elements.bookingForm.reset();
    elements.bookingMessage.textContent = "";
  }
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
        const canFavorite = Boolean(state.token && state.experience?.allowedActions.includes("favorite.manage"));
        const existingFavorite = state.favorites.find((favorite) => favorite.providerId === provider.id);
        const favoriteButton = canFavorite
          ? `<button class="button ghost favorite-provider-button" data-provider-id="${escapeHtml(provider.id)}" data-favorite-id="${escapeHtml(existingFavorite?.id ?? "")}">${existingFavorite ? "お気に入りを解除" : "お気に入りに保存"}</button>`
          : "";
        const profileButton = state.experience?.visibleModules.includes("providerProfile")
          ? `<button class="button ghost provider-profile-button" data-provider-id="${escapeHtml(provider.id)}">プロフィールを見る</button>`
          : "";
        const isCompared = state.compareProviderIds.includes(provider.id);
        const compareButton = state.experience?.visibleModules.includes("providerProfile")
          ? `<button class="button ghost provider-compare-button" data-provider-id="${escapeHtml(provider.id)}">${isCompared ? "比較から外す" : "比較に追加"}</button>`
          : "";
        return `<article class="provider-item"><h3>${escapeHtml(provider.name)}</h3><div class="meta"><span>${escapeHtml(provider.location)}</span><span>${formatValue(provider.themes)}</span>${publicFields}</div>${profileButton}${compareButton}${contactButton}${favoriteButton}</article>`;
      }).join("")
    : '<p class="empty">該当する事業者がありません。</p>';
  elements.requestProvider.innerHTML = items.map((provider) => `<option value="${escapeHtml(provider.id)}">${escapeHtml(provider.name)}</option>`).join("");
  elements.bookingProvider.innerHTML = items.map((provider) => `<option value="${escapeHtml(provider.id)}">${escapeHtml(provider.name)}</option>`).join("");
  elements.inquiryProvider.innerHTML = items.map((provider) => `<option value="${escapeHtml(provider.id)}">${escapeHtml(provider.name)}</option>`).join("");
  document.querySelectorAll(".inquiry-provider-button").forEach((button) => {
    button.addEventListener("click", () => {
      elements.inquiryProvider.value = button.dataset.providerId ?? "";
      elements.inquiryForm.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });
  document.querySelectorAll(".favorite-provider-button").forEach((button) => {
    button.addEventListener("click", () => void toggleFavorite(button.dataset.providerId ?? "", button.dataset.favoriteId ?? ""));
  });
  document.querySelectorAll(".provider-profile-button").forEach((button) => {
    button.addEventListener("click", () => void openProviderProfile(button.dataset.providerId ?? ""));
  });
  document.querySelectorAll(".provider-compare-button").forEach((button) => {
    button.addEventListener("click", () => toggleProviderComparison(button.dataset.providerId ?? ""));
  });
  renderListPagination(elements.providerPagination, page, cursor, reloadProviders, "事業者一覧のページ移動");
}

const directoryGuideKindLabels = { directory: "検索・相談", booking: "検索・予約", provider_resource: "事業者向け" };

function providerFieldText(value) {
  if (Array.isArray(value)) return value.join(" / ");
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value ?? "");
}

function clearProviderProfile() {
  state.providerProfile = null;
  elements.providerProfilePanel.hidden = true;
  elements.providerProfileName.textContent = "事業者プロフィール";
  elements.providerProfileSummary.textContent = "一覧から事業者を選ぶと、現在のロールで表示できる詳細を確認できます。";
  elements.providerProfileMeta.replaceChildren();
  elements.providerProfileFields.replaceChildren();
  elements.providerProfileRequest.hidden = true;
  elements.providerProfileRequest.dataset.providerId = "";
  elements.providerProfileBooking.hidden = true;
  elements.providerProfileBooking.dataset.providerId = "";
  elements.providerProfileInquiry.hidden = true;
  elements.providerProfileInquiry.dataset.providerId = "";
  setListStatus(elements.providerProfileStatus);
}

function renderProviderProfile(provider) {
  state.providerProfile = provider;
  elements.providerProfilePanel.hidden = false;
  elements.providerProfileName.textContent = provider.name;
  elements.providerProfileSummary.textContent = `${provider.location} · ${provider.themes.join("・")}`;
  elements.providerProfileMeta.replaceChildren();
  for (const [label, value] of [["カテゴリ", provider.category], ["事業者ID", provider.id]]) {
    const item = document.createElement("span");
    item.textContent = `${label}: ${providerFieldText(value)}`;
    elements.providerProfileMeta.append(item);
  }

  const profileFields = Object.entries(provider).filter(([key]) => !["id", "category", "name", "themes", "location"].includes(key));
  elements.providerProfileFields.replaceChildren();
  if (!profileFields.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "追加の公開情報はありません。";
    elements.providerProfileFields.append(empty);
  } else {
    for (const [key, value] of profileFields) {
      const field = document.createElement("div");
      field.className = "provider-profile-field";
      const label = document.createElement("span");
      label.textContent = key;
      const content = document.createElement("strong");
      content.textContent = providerFieldText(value);
      field.append(label, content);
      elements.providerProfileFields.append(field);
    }
  }

  const canRequest = Boolean(state.token && state.experience?.allowedActions.includes("request.create"));
  elements.providerProfileRequest.hidden = !canRequest;
  elements.providerProfileRequest.dataset.providerId = canRequest ? provider.id : "";
  const canBook = Boolean(state.token && state.experience?.allowedActions.includes("booking.create"));
  elements.providerProfileBooking.hidden = !canBook;
  elements.providerProfileBooking.dataset.providerId = canBook ? provider.id : "";
  const canInquire = Boolean(state.token && state.experience?.allowedActions.includes("inquiry.create"));
  elements.providerProfileInquiry.hidden = !canInquire;
  elements.providerProfileInquiry.dataset.providerId = provider.id;
}

async function openProviderProfile(providerId) {
  if (!providerId) return;
  const listedProvider = state.providers.find((provider) => provider.id === providerId);
  elements.providerProfilePanel.hidden = false;
  elements.providerProfileName.textContent = listedProvider?.name ?? "事業者プロフィール";
  elements.providerProfileSummary.textContent = "現在のロールで表示できる詳細情報を読み込んでいます。";
  elements.providerProfileMeta.replaceChildren();
  elements.providerProfileFields.replaceChildren();
  elements.providerProfileRequest.hidden = true;
  elements.providerProfileRequest.dataset.providerId = "";
  elements.providerProfileBooking.hidden = true;
  elements.providerProfileBooking.dataset.providerId = "";
  elements.providerProfileInquiry.hidden = true;
  elements.providerProfileInquiry.dataset.providerId = "";
  setListStatus(elements.providerProfileStatus, "loading", "事業者プロフィールを読み込んでいます。");
  elements.providerProfilePanel.scrollIntoView({ behavior: "smooth", block: "center" });
  try {
    const body = await api(`/api/v1/providers/${encodeURIComponent(providerId)}`);
    renderProviderProfile(body.item);
    setListStatus(elements.providerProfileStatus);
  } catch (error) {
    setListStatus(elements.providerProfileStatus, "error", "事業者プロフィールを読み込めませんでした。再試行してください。", () => openProviderProfile(providerId));
  }
}

function focusRequestForm(providerId) {
  if (!providerId) return;
  elements.requestProvider.value = providerId;
  elements.requestForm.scrollIntoView({ behavior: "smooth", block: "center" });
  elements.requestForm.querySelector("input[name=title]")?.focus();
}

function focusBookingForm(providerId) {
  if (!providerId) return;
  elements.bookingProvider.value = providerId;
  elements.bookingForm.scrollIntoView({ behavior: "smooth", block: "center" });
  elements.bookingForm.querySelector("input[name=requestedFor]")?.focus();
}

function comparisonProviders() {
  if (state.providerComparison.length > 0) return state.providerComparison;
  return state.compareProviderIds.map((providerId) => state.providers.find((provider) => provider.id === providerId)).filter(Boolean);
}

function renderProviderComparison() {
  const selectedCount = state.compareProviderIds.length;
  elements.providerComparePanel.hidden = selectedCount === 0;
  elements.providerCompareRun.hidden = selectedCount < 2;
  const items = comparisonProviders();
  elements.providerCompareList.replaceChildren();
  if (items.length > 0) {
    const grid = document.createElement("div");
    grid.className = "provider-compare-grid";
    for (const provider of items) {
      const card = document.createElement("article");
      card.className = "provider-compare-card";
      const title = document.createElement("h3");
      title.textContent = provider.name;
      const meta = document.createElement("div");
      meta.className = "meta";
      const location = document.createElement("span");
      location.textContent = provider.location;
      const themes = document.createElement("span");
      themes.textContent = provider.themes.join("・");
      meta.append(location, themes);
      card.append(title, meta);
      const fields = Object.entries(provider).filter(([key]) => !["id", "category", "name", "themes", "location"].includes(key));
      if (fields.length > 0) {
        const details = document.createElement("dl");
        for (const [key, value] of fields) {
          const label = document.createElement("dt");
          label.textContent = key;
          const content = document.createElement("dd");
          content.textContent = providerFieldText(value);
          details.append(label, content);
        }
        card.append(details);
      }
      grid.append(card);
    }
    elements.providerCompareList.append(grid);
  }
  if (selectedCount > 0 && selectedCount < 2) {
    setListStatus(elements.providerCompareStatus, "info", "比較する事業者をもう1件選択してください。");
  } else if (selectedCount >= 2 && state.providerComparison.length === 0) {
    setListStatus(elements.providerCompareStatus, "info", "比較結果を表示できます。");
  } else {
    setListStatus(elements.providerCompareStatus);
  }
}

function updateProviderCompareButtons() {
  document.querySelectorAll(".provider-compare-button").forEach((button) => {
    const providerId = button.dataset.providerId ?? "";
    const selected = state.compareProviderIds.includes(providerId);
    button.textContent = selected ? "比較から外す" : "比較に追加";
    button.setAttribute("aria-pressed", String(selected));
  });
}

function toggleProviderComparison(providerId) {
  if (!providerId) return;
  const index = state.compareProviderIds.indexOf(providerId);
  if (index >= 0) {
    state.compareProviderIds.splice(index, 1);
  } else {
    if (state.compareProviderIds.length >= providerCompareLimit) {
      setMessage(`比較できる事業者は最大${providerCompareLimit}件です。`);
      return;
    }
    state.compareProviderIds.push(providerId);
  }
  state.providerComparison = [];
  renderProviderComparison();
  updateProviderCompareButtons();
}

async function loadProviderComparison() {
  if (state.compareProviderIds.length < 2) {
    renderProviderComparison();
    return;
  }
  setListStatus(elements.providerCompareStatus, "loading", "事業者の比較結果を読み込んでいます。");
  try {
    const ids = state.compareProviderIds.map((providerId) => encodeURIComponent(providerId)).join(",");
    const body = await api(`/api/v1/providers/compare?category=${encodeURIComponent(state.category)}&ids=${ids}`);
    state.providerComparison = body.items;
    renderProviderComparison();
  } catch (error) {
    setListStatus(elements.providerCompareStatus, "error", "事業者を比較できませんでした。再試行してください。", () => loadProviderComparison());
  }
}

function clearProviderComparison() {
  state.compareProviderIds = [];
  state.providerComparison = [];
  elements.providerComparePanel.hidden = true;
  elements.providerCompareRun.hidden = true;
  elements.providerCompareList.replaceChildren();
  setListStatus(elements.providerCompareStatus);
  updateProviderCompareButtons();
}

function renderFavorites(items) {
  state.favorites = items;
  elements.favorites.setAttribute("aria-busy", "false");
  elements.favoritePanel.hidden = !Boolean(state.token && state.experience?.allowedActions.includes("favorite.manage"));
  elements.favorites.innerHTML = items.length
    ? items.map((favorite) => `<article class="directory-guide-item"><div class="meta"><span>${escapeHtml(favorite.category)}</span><span>保存日 ${escapeHtml(favorite.createdAt.slice(0, 10))}</span></div><h3>${escapeHtml(favorite.provider.name)}</h3><p>${escapeHtml(favorite.provider.location)} · ${escapeHtml(favorite.provider.themes.join("・"))}</p><button class="button ghost favorite-remove-button" data-favorite-id="${escapeHtml(favorite.id)}">お気に入りを解除</button></article>`).join("")
    : '<p class="empty">保存した事業者はありません。</p>';
  elements.favorites.querySelectorAll(".favorite-remove-button").forEach((button) => {
    button.addEventListener("click", () => void toggleFavorite("", button.dataset.favoriteId ?? ""));
  });
}

async function reloadFavorites() {
  const visible = Boolean(state.token && state.experience?.allowedActions.includes("favorite.manage"));
  elements.favoritePanel.hidden = !visible;
  if (!visible) {
    state.favorites = [];
    elements.favorites.replaceChildren();
    return;
  }
  setListStatus(elements.favoriteStatus, "loading", "保存した事業者を読み込んでいます。");
  try {
    const body = await api("/api/v1/favorites?limit=50");
    renderFavorites(body.items);
    setListStatus(elements.favoriteStatus);
  } catch (error) {
    setListStatus(elements.favoriteStatus, "error", "お気に入りを読み込めませんでした。再試行してください。", () => reloadFavorites());
    throw error;
  }
}

async function toggleFavorite(providerId, favoriteId) {
  try {
    if (favoriteId) {
      await api(`/api/v1/favorites/${encodeURIComponent(favoriteId)}`, { method: "DELETE" });
      setMessage("お気に入りから解除しました。");
    } else {
      await api("/api/v1/favorites", { method: "POST", body: JSON.stringify({ providerId }) });
      setMessage("お気に入りに保存しました。");
    }
    await reloadFavorites();
    await reloadProviders();
  } catch (error) {
    setMessage(error.message);
  }
}

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
const bookingStatusLabels = { requested: "受付中", confirmed: "確定", cancelled: "取消" };

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

function renderBookings(items) {
  state.bookings = items;
  const isProvider = state.role === "provider";
  const canProviderUpdate = isProvider && state.experience?.allowedActions.includes("booking.status.update");
  elements.bookingList.innerHTML = items.length
    ? items.map((booking) => {
        const provider = state.providers.find((candidate) => candidate.id === booking.providerId);
        const actions = [];
        if (canProviderUpdate) {
          if (booking.status === "requested") actions.push(["confirmed", "予約を確定"], ["cancelled", "予約を取消"]);
          else if (booking.status === "confirmed") actions.push(["cancelled", "予約を取消"]);
        } else if (!isProvider && (booking.status === "requested" || booking.status === "confirmed")) {
          actions.push(["cancelled", "予約を取消"]);
        }
        const requestedFor = String(booking.requestedFor ?? "").slice(0, 16).replace("T", " ");
        return `<article class="role-item" data-booking-id="${escapeHtml(booking.id)}"><div class="meta"><span>${escapeHtml(bookingStatusLabels[booking.status] ?? booking.status)}</span><span>${escapeHtml(provider?.name ?? booking.providerId)}</span><span>${escapeHtml(requestedFor)}</span></div><h3>${escapeHtml(booking.menu)}</h3><p>${escapeHtml(booking.note || "要望なし")}</p><div class="role-actions">${actions.map(([status, label]) => `<button class="button ghost booking-status-button" data-status="${escapeHtml(status)}">${escapeHtml(label)}</button>`).join("")}</div></article>`;
      }).join("")
    : '<p class="empty">予約リクエストはありません。</p>';
  document.querySelectorAll("[data-booking-id] .booking-status-button").forEach((button) => {
    button.addEventListener("click", () => {
      const bookingItem = button.closest("[data-booking-id]");
      if (bookingItem?.dataset.bookingId) void updateBookingStatus(bookingItem.dataset.bookingId, button.dataset.status ?? "");
    });
  });
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

async function reloadBookings() {
  const canSeeBookings = Boolean(state.token && state.experience?.allowedActions.includes("booking.read"));
  elements.bookingStatusPanel.hidden = !canSeeBookings;
  if (!canSeeBookings) {
    state.bookings = [];
    elements.bookingList.replaceChildren();
    setListStatus(elements.bookingStatusMessage);
    return;
  }
  setListStatus(elements.bookingStatusMessage, "loading", "予約リクエストを読み込んでいます。");
  const query = elements.bookingStatusFilter.value ? `?status=${encodeURIComponent(elements.bookingStatusFilter.value)}` : "";
  try {
    const body = await api(`/api/v1/bookings${query}`);
    renderBookings(body.items);
    setListStatus(elements.bookingStatusMessage);
  } catch (error) {
    setListStatus(elements.bookingStatusMessage, "error", "予約リクエストを読み込めませんでした。再試行してください。", () => void reloadBookings());
    throw error;
  }
}

async function updateBookingStatus(bookingId, status) {
  if (!bookingId || !status) return;
  try {
    await api(`/api/v1/bookings/${encodeURIComponent(bookingId)}`, { method: "PATCH", body: JSON.stringify({ status }) });
    setMessage("予約リクエストの状態を更新しました。");
    await reloadBookings();
  } catch (error) {
    setMessage(error.message);
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
  const canSeeApplications = Boolean(state.token && (isRecruiterRole(state.role) || state.role === "provider"));
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

function setMediaManagementMessage(message = "") {
  elements.mediaManagementMessage.textContent = message;
}

function setPortalPlanningMessage(message = "") {
  elements.portalPlanningMessage.textContent = message;
}

function renderPortalPlan(plan, proposals = [], drafts = []) {
  if (!plan) {
    elements.portalPlanResult.hidden = true;
    elements.portalPlanResult.replaceChildren();
    return;
  }
  const pageItems = Array.isArray(plan.pageIdeas) ? plan.pageIdeas : [];
  const gaps = Array.isArray(plan.gaps) ? plan.gaps : [];
  const proposalCount = proposals.length || plan.appliedProposalIds?.length || 0;
  const draftCount = drafts.length || plan.draftIds?.length || 0;
  elements.portalPlanResult.hidden = false;
  elements.portalPlanResult.innerHTML = `
    <article class="editor-item">
      <div class="meta"><span>${escapeHtml(plan.categoryLabel)}</span><span>${escapeHtml(plan.theme)}</span>${plan.region ? `<span>${escapeHtml(plan.region)}</span>` : ""}</div>
      <h3>${escapeHtml(plan.theme)}のポータル企画</h3>
      <p>検索意図 ${escapeHtml(String(plan.searchIntents?.length ?? 0))}件 / ページ案 ${escapeHtml(String(pageItems.length))}件 / テーマ一致コンテンツ ${escapeHtml(String(plan.coverage?.matchingContentCount ?? 0))}件 / 未充足項目 ${escapeHtml(String(gaps.length))}件</p>
      <ul>${pageItems.map((page) => `<li><strong>${escapeHtml(page.title)}</strong><br><span class="muted">${escapeHtml(page.primaryKeyword)} — ${escapeHtml(page.purpose)}</span></li>`).join("")}</ul>
      <p class="field-note">${draftCount > 0 ? `コンテンツ下書き ${escapeHtml(String(draftCount))}件を作成済みです。` : proposalCount > 0 ? `コンテンツ企画案 ${escapeHtml(String(proposalCount))}件を作成済みです。下書きへ進められます。` : "企画案から対象ポジション別の下書きを作成できます。"}</p>
      ${draftCount === 0 ? `<button class="button secondary portal-plan-draft-button" type="button" data-plan-id="${escapeHtml(plan.id)}">${proposalCount > 0 ? "企画案から下書きを作成" : "企画案と下書きを作成"}</button>` : ""}
    </article>`;
  elements.portalPlanResult.querySelector(".portal-plan-draft-button")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const body = await api(`/api/v1/portal-plans/${encodeURIComponent(button.dataset.planId ?? "")}/draft`, { method: "POST" });
      renderPortalPlan(body.plan, body.proposals, body.drafts);
      setPortalPlanningMessage(`コンテンツ下書き ${body.drafts.length}件を作成しました。AIコンテンツ編集で清書・SEO監査へ進めます。`);
      await reloadPortalPlanning();
      await reloadContent();
    } catch (error) {
      button.disabled = false;
      setPortalPlanningMessage(error.message);
    }
  });
}

function renderPortalPlanList(plans) {
  elements.portalPlanList.innerHTML = plans.length
    ? `<div class="section-kicker">RECENT PLANS</div>${plans.map((plan) => `<article class="editor-item"><div class="meta"><span>${escapeHtml(plan.theme)}</span>${plan.region ? `<span>${escapeHtml(plan.region)}</span>` : ""}<span>${plan.draftIds?.length ? "下書き済み" : plan.appliedProposalIds?.length ? "企画済み" : "未適用"}</span></div><p>${escapeHtml(plan.pageIdeas?.[0]?.title ?? "ポータル企画")}</p><button class="button ghost portal-plan-load-button" type="button" data-plan-id="${escapeHtml(plan.id)}">この企画を表示</button></article>`).join("")}`
    : '<p class="empty">作成済みのポータル企画はありません。</p>';
  elements.portalPlanList.querySelectorAll(".portal-plan-load-button").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        const body = await api(`/api/v1/portal-plans/${encodeURIComponent(button.dataset.planId ?? "")}`);
        renderPortalPlan(body.item);
        elements.portalPlanResult.scrollIntoView({ behavior: "smooth", block: "nearest" });
      } catch (error) {
        setPortalPlanningMessage(error.message);
      }
    });
  });
}

async function reloadPortalPlanning() {
  const visible = Boolean(state.token && state.role === "provider" && state.experience?.allowedActions.includes("portal.plan.create"));
  elements.portalPlanningPanel.hidden = !visible;
  if (!visible) {
    elements.portalPlanResult.hidden = true;
    elements.portalPlanResult.replaceChildren();
    elements.portalPlanList.replaceChildren();
    setPortalPlanningMessage();
    return;
  }
  try {
    const body = await api("/api/v1/portal-plans?limit=20");
    renderPortalPlanList(body.items);
  } catch (error) {
    setPortalPlanningMessage(error.message);
  }
}

function renderMediaAssets(items) {
  state.mediaAssets = items;
  elements.mediaList.innerHTML = items.length
    ? items.map((asset) => `<article class="editor-item"><div class="meta"><span>${escapeHtml(asset.mediaType)}</span><span>${escapeHtml(asset.status)}</span><span>${escapeHtml(asset.rightsStatus)}</span></div><h3>${escapeHtml(asset.name)}</h3><p>${escapeHtml(asset.altText)} / ${escapeHtml(String(asset.sizeBytes))} bytes</p><div class="editor-actions"><button class="button ghost media-transform-button" data-asset-id="${escapeHtml(asset.id)}">変換アセット作成</button>${asset.status !== "archived" ? `<button class="button ghost media-archive-button" data-asset-id="${escapeHtml(asset.id)}">アーカイブ</button>` : ""}</div></article>`).join("")
    : '<p class="empty">登録済みメディアはありません。</p>';
  document.querySelectorAll(".media-transform-button").forEach((button) => {
    button.addEventListener("click", async () => {
      const format = window.prompt("変換形式を指定してください（webp / avif / jpg / png / mp4 / webm）", "webp") ?? "";
      if (!format) return;
      try {
        await api(`/api/v1/media/${encodeURIComponent(button.dataset.assetId ?? "")}/transform`, { method: "POST", body: JSON.stringify({ format: format.trim() }) });
        setMediaManagementMessage("変換アセットを作成しました。実体変換はBuilderOS Adapterへ委譲できます。");
        await reloadMediaManagement();
      } catch (error) {
        setMediaManagementMessage(error.message);
      }
    });
  });
  document.querySelectorAll(".media-archive-button").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!window.confirm("このメディアをアーカイブしますか？")) return;
      try {
        await api(`/api/v1/media/${encodeURIComponent(button.dataset.assetId ?? "")}`, { method: "DELETE" });
        setMediaManagementMessage("メディアをアーカイブしました。");
        await reloadMediaManagement();
      } catch (error) {
        setMediaManagementMessage(error.message);
      }
    });
  });
}

async function reloadMediaManagement() {
  const visible = Boolean(state.token && state.role === "provider" && state.experience?.allowedActions.includes("media.read"));
  elements.mediaManagementPanel.hidden = !visible;
  if (!visible) {
    elements.mediaList.innerHTML = "";
    elements.mediaSeoAuditResult.hidden = true;
    elements.mediaSeoAuditResult.textContent = "";
    return;
  }
  const requestVersion = beginListRequest("media", elements.mediaList);
  try {
    const body = await api("/api/v1/media?sort=updatedAt_desc&limit=50");
    if (isLatestListRequest("media", requestVersion)) renderMediaAssets(body.items);
  } catch (error) {
    if (isLatestListRequest("media", requestVersion)) elements.mediaList.innerHTML = `<p class="empty">${escapeHtml(error.message)}</p>`;
  } finally {
    finishListRequest("media", requestVersion, elements.mediaList);
  }
}

async function runMediaSeoAudit() {
  try {
    const body = await api("/api/v1/media/seo-audit", { method: "POST", body: JSON.stringify({}) });
    const issueSummary = body.item.issues.length === 0
      ? "問題は検出されませんでした。"
      : body.item.issues.map((issue) => `[${issue.severity}] ${issue.assetId ?? "asset"} ${issue.code}: ${issue.message}`).join("\n");
    elements.mediaSeoAuditResult.hidden = false;
    elements.mediaSeoAuditResult.textContent = `スコア: ${body.item.score} / 100\n対象アセット: ${body.item.assetCount}件\n${issueSummary}`;
  } catch (error) {
    elements.mediaSeoAuditResult.hidden = false;
    elements.mediaSeoAuditResult.textContent = error.message;
  }
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

function contentActionButtons(content) {
  const translationAction = content.status !== "archived"
    ? `<button class="button ghost content-action" data-action="translate" data-content-id="${escapeHtml(content.id)}">翻訳下書き</button>`
    : "";
  const actions = [
    `<button class="button ghost content-action" data-action="preview" data-content-id="${escapeHtml(content.id)}">本文を見る</button>`,
    `<button class="button ghost content-action" data-action="versions" data-content-id="${escapeHtml(content.id)}">版履歴</button>`,
    `<button class="button ghost content-action" data-action="reviews" data-content-id="${escapeHtml(content.id)}">レビュー履歴</button>`,
  ];
  if (content.status !== "approved" && content.status !== "published" && content.status !== "review_requested") actions.push(`<button class="button ghost content-action" data-action="fact" data-content-id="${escapeHtml(content.id)}">事実確認</button>`);
  if (content.status === "drafted" || content.status === "polished" || content.status === "changes_requested") actions.push(`<button class="button ghost content-action" data-action="polish" data-content-id="${escapeHtml(content.id)}">清書</button>`);
  if (content.status === "polished" || content.status === "seo_reviewed") actions.push(`<button class="button ghost content-action" data-action="audit" data-content-id="${escapeHtml(content.id)}">SEO監査</button>`);
  if (content.status === "seo_reviewed") actions.push(`<button class="button primary content-action" data-action="request-review" data-content-id="${escapeHtml(content.id)}">レビュー依頼</button>`);
  if (content.status === "review_requested") {
    actions.push(`<button class="button primary content-action" data-action="approve" data-content-id="${escapeHtml(content.id)}">承認</button>`);
    actions.push(`<button class="button ghost content-action" data-action="request-changes" data-content-id="${escapeHtml(content.id)}">差し戻し</button>`);
  }
  if (content.status === "approved") {
    actions.push(`<button class="button ghost content-action" data-action="build" data-content-id="${escapeHtml(content.id)}">静的ビルド</button>`);
    actions.push(`<button class="button primary content-action" data-action="publish" data-content-id="${escapeHtml(content.id)}">BuilderOS Adapterで公開</button>`);
    if (state.experience?.allowedActions.includes("publication.schedule")) actions.push(`<button class="button ghost content-action" data-action="schedule" data-content-id="${escapeHtml(content.id)}">予約公開</button>`);
  }
  if (content.status === "published") actions.push(`<button class="button ghost content-action" data-action="unpublish" data-content-id="${escapeHtml(content.id)}">公開を取り消す</button>`);
  if (translationAction) actions.unshift(translationAction);
  return actions.join("");
}

function renderContents(items) {
  state.contents = items;
  elements.contents.innerHTML = items.length
    ? items.map((content) => `<article class="editor-item"><div class="meta"><span>${escapeHtml(content.status)}</span><span>${escapeHtml(content.locale ?? "ja")}</span><span>v${escapeHtml(content.version)}</span></div><h3>${escapeHtml(content.title)}</h3><p>${escapeHtml(content.summary)}</p><div class="editor-actions">${contentActionButtons(content)}</div></article>`).join("")
    : '<p class="empty">下書きがまだありません。</p>';
  document.querySelectorAll(".content-action").forEach((button) => {
    button.addEventListener("click", () => handleContentAction(button.dataset.action, button.dataset.contentId));
  });
}

const contentVersionReasonLabels = { created: "作成", updated: "更新", polished: "清書", workflow: "状態変更", restored: "復元", migrated: "移行" };

function renderContentVersions(items) {
  elements.contentVersions.innerHTML = items.length
    ? items.map((version) => `<article class="editor-item"><div class="meta"><span>v${escapeHtml(version.version)}</span><span>${escapeHtml(contentVersionReasonLabels[version.reason] ?? version.reason)}</span><span>${escapeHtml(version.createdAt.slice(0, 10))}</span></div><h4>${escapeHtml(version.title)}</h4><p>${escapeHtml(version.status)} / ${escapeHtml(version.actorId ?? "system")}</p><button class="button ghost content-version-restore-button" data-content-id="${escapeHtml(version.contentId)}" data-version="${escapeHtml(version.version)}">この版を下書きとして復元</button></article>`).join("")
    : '<p class="empty">版履歴がまだありません。</p>';
  document.querySelectorAll(".content-version-restore-button").forEach((button) => {
    button.addEventListener("click", () => handleContentVersionRestore(button.dataset.contentId, Number(button.dataset.version)));
  });
}

const contentReviewStatusLabels = { requested: "レビュー中", changes_requested: "差し戻し", approved: "承認済み" };

function renderContentReviews(items) {
  elements.contentReviews.innerHTML = items.length
    ? items.map((review) => `<article class="editor-item"><div class="meta"><span>${escapeHtml(contentReviewStatusLabels[review.status] ?? review.status)}</span><span>v${escapeHtml(review.contentVersion)}</span><span>${escapeHtml(review.updatedAt.slice(0, 10))}</span></div><p>${escapeHtml(review.requestNote ?? "レビュー依頼")}</p>${review.responseNote ? `<p class="muted">差し戻し理由: ${escapeHtml(review.responseNote)}</p>` : ""}</article>`).join("")
    : '<p class="empty">レビュー履歴がまだありません。</p>';
}

async function reloadContentVersions(contentId) {
  if (!contentId) {
    elements.contentVersions.innerHTML = "";
    return;
  }
  try {
    const body = await api(`/api/v1/content/${encodeURIComponent(contentId)}/versions`);
    renderContentVersions(body.items);
  } catch (error) {
    elements.contentVersions.innerHTML = `<p class="empty">${escapeHtml(error.message)}</p>`;
  }
}

async function reloadContentReviews(contentId) {
  if (!contentId) {
    elements.contentReviews.innerHTML = "";
    return;
  }
  try {
    const body = await api(`/api/v1/content/${encodeURIComponent(contentId)}/reviews`);
    renderContentReviews(body.items);
  } catch (error) {
    elements.contentReviews.innerHTML = `<p class="empty">${escapeHtml(error.message)}</p>`;
  }
}

async function handleContentVersionRestore(contentId, version) {
  if (!contentId || !Number.isInteger(version)) return;
  try {
    await api(`/api/v1/content/${encodeURIComponent(contentId)}/versions/${version}/restore`, { method: "POST", body: JSON.stringify({}) });
    setContentMessage("指定した版を下書きとして復元しました。事実確認とSEO監査を再実行してください。");
    await reloadContentVersions(contentId);
  } catch (error) {
    setContentMessage(error.message);
  }
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

function renderPublicationSchedules(items) {
  elements.publicationScheduleList.innerHTML = items.length
    ? items.map((item) => `<article class="editor-item"><div class="meta"><span>${escapeHtml(item.status)}</span><span>${escapeHtml(item.scheduledFor)}</span><span>${escapeHtml(String(item.contentIds.length))}件</span></div><h4>${escapeHtml(item.id)}</h4>${item.status === "scheduled" ? `<button class="button ghost publication-schedule-cancel-button" data-schedule-id="${escapeHtml(item.id)}">予約を取り消す</button>` : `<p class="muted">${escapeHtml(item.lastError ?? "実行済みまたは取消済み")}</p>`}</article>`).join("")
    : '<p class="empty">予約公開はありません。</p>';
  document.querySelectorAll(".publication-schedule-cancel-button").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!window.confirm("この予約公開を取り消しますか？")) return;
      try {
        await api(`/api/v1/publications/schedules/${encodeURIComponent(button.dataset.scheduleId ?? "")}/cancel`, { method: "POST", body: JSON.stringify({}) });
        setContentMessage("予約公開を取り消しました。");
        await reloadPublicationSchedules();
      } catch (error) {
        setContentMessage(error.message);
      }
    });
  });
}

async function reloadPublicationSchedules() {
  const visible = state.token && state.role === "provider" && state.experience?.allowedActions.includes("publication.schedule_list");
  elements.publicationSchedulePanel.hidden = !visible;
  if (!visible) {
    elements.publicationScheduleList.replaceChildren();
    return;
  }
  try {
    const body = await api("/api/v1/publications/schedules");
    renderPublicationSchedules(body.items);
  } catch (error) {
    elements.publicationScheduleList.innerHTML = `<p class="empty">${escapeHtml(error.message)}</p>`;
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
  if (!visible) {
    elements.contentVersions.innerHTML = "";
    elements.contentReviews.innerHTML = "";
    elements.siteSeoAuditResult.hidden = true;
    elements.siteSeoAuditResult.textContent = "";
    return;
  }
  const proposals = await api("/api/v1/content/proposals");
  const contents = await api("/api/v1/content");
  renderProposals(proposals.items);
  renderContents(contents.items);
  await reloadPublicationHistory();
  await reloadPublicationSchedules();
}

async function runSiteSeoAudit() {
  try {
    const body = await api("/api/v1/seo/audit");
    const issueSummary = body.item.issues.length === 0
      ? "問題は検出されませんでした。"
      : body.item.issues.map((issue) => `[${issue.severity}] ${issue.code}: ${issue.message}`).join("\n");
    elements.siteSeoAuditResult.hidden = false;
    elements.siteSeoAuditResult.textContent = `スコア: ${body.item.score} / 100\n公開対象: ${body.item.publicContentCount}件\n${issueSummary}`;
  } catch (error) {
    elements.siteSeoAuditResult.hidden = false;
    elements.siteSeoAuditResult.textContent = error.message;
  }
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
    if (action === "versions") {
      await reloadContentVersions(contentId);
      elements.contentVersions.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    if (action === "reviews") {
      await reloadContentReviews(contentId);
      elements.contentReviews.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    if (action === "translate") {
      const targetLocale = window.prompt("翻訳先を入力してください（ja / en / zh-CN / es / ko / de / fr）", "en") ?? "";
      if (!["ja", "en", "zh-CN", "es", "ko", "de", "fr"].includes(targetLocale)) return;
      const body = await api(`/api/v1/content/${encodeURIComponent(contentId)}/translate`, { method: "POST", body: JSON.stringify({ targetLocale }) });
      setContentMessage(`翻訳下書きを作成しました（${body.item.locale}）。翻訳文・SEO情報を確認してから事実確認へ進んでください。`);
    } else if (action === "polish") {
      const instructions = window.prompt("清書方針（任意）") ?? "";
      await api(`/api/v1/content/${encodeURIComponent(contentId)}/polish`, { method: "POST", body: JSON.stringify({ instructions }) });
      setContentMessage("清書しました。SEO監査へ進めます。");
    } else if (action === "fact") {
      const body = await api(`/api/v1/content/${encodeURIComponent(contentId)}/fact-check`, { method: "POST" });
      setContentMessage(body.item.passed ? "一次情報の登録を確認しました。" : `事実確認の指摘: ${body.item.issues.join(" ")}`);
    } else if (action === "audit") {
      const body = await api(`/api/v1/content/${encodeURIComponent(contentId)}/seo-audit`, { method: "POST" });
      setContentMessage(`SEO監査スコア: ${body.item.score} / 100（指摘 ${body.item.issues.length}件）`);
    } else if (action === "request-review") {
      const note = window.prompt("レビュー依頼メモ（任意）") ?? "";
      await api(`/api/v1/content/${encodeURIComponent(contentId)}/review-request`, { method: "POST", body: JSON.stringify({ note }) });
      setContentMessage("レビューを依頼しました。");
    } else if (action === "request-changes") {
      const note = window.prompt("差し戻し理由（3文字以上）") ?? "";
      await api(`/api/v1/content/${encodeURIComponent(contentId)}/request-changes`, { method: "POST", body: JSON.stringify({ note }) });
      setContentMessage("差し戻し理由を記録しました。再編集と再監査を行ってください。");
    } else if (action === "approve") {
      await api(`/api/v1/content/${encodeURIComponent(contentId)}/approve`, { method: "POST" });
      setContentMessage("人間の確認済みとして承認しました。");
    } else if (action === "unpublish") {
      if (!window.confirm("この公開済みコンテンツを静的サイトから除外しますか？")) return;
      const body = await api("/api/v1/publications/unpublish", { method: "POST", body: JSON.stringify({ contentIds: [contentId], baseUrl: window.location.origin }) });
      setContentMessage(body.item.deployment.status === "submitted" ? "公開取消と静的サイトの更新が完了しました。" : "dry-runのため、公開状態は変更していません。");
    } else if (action === "build") {
      const body = await api("/api/v1/publications/build", { method: "POST", body: JSON.stringify({ contentIds: [contentId], baseUrl: window.location.origin }) });
      setContentMessage(`静的ビルド完了: ${body.item.files.length}ファイル。BuilderOS Adapterへ渡せます。`);
    } else if (action === "publish") {
      if (!window.confirm("承認済みコンテンツをBuilderOS Adapter経由で公開しますか？")) return;
      const body = await api("/api/v1/publications/publish", { method: "POST", body: JSON.stringify({ contentIds: [contentId], baseUrl: window.location.origin }) });
      setContentMessage(body.item.deployment.status === "submitted" ? "BuilderOS Adapter経由で公開しました。" : "dry-runのため、公開状態は変更していません。公開設定を確認してください。");
    } else if (action === "schedule") {
      const defaultTime = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const scheduledFor = window.prompt("公開日時をISO 8601形式で指定してください。", defaultTime) ?? "";
      if (!scheduledFor.trim()) return;
      await api("/api/v1/publications/schedules", { method: "POST", body: JSON.stringify({ contentIds: [contentId], scheduledFor: scheduledFor.trim(), baseUrl: window.location.origin }) });
      setContentMessage("予約公開を作成しました。外部スケジューラから実行できます。");
      await reloadPublicationSchedules();
    }
    await reloadContent();
  } catch (error) {
    setContentMessage(error.message);
  }
}

async function reload() {
  clearProviderProfile();
  clearProviderComparison();
  const contextBody = await api(`/api/v1/categories/${encodeURIComponent(state.category)}`);
  renderExperience(contextBody.item.experience, contextBody.item.navigation, contextBody.item.themeOptions);
  await reloadProviderManagement();
  await reloadPortalPlanning();
  await reloadMediaManagement();
  await reloadRoleData();
  await reloadFavorites();
  await reloadProviders();
  await reloadBookings();
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
  clearSessionState();
  setMessage("ログアウトしました。");
  await reload();
}

elements.category.addEventListener("change", async () => {
  const previousCategory = state.category;
  const nextCategory = elements.category.value;
  const nextContext = contextForCategory(nextCategory);
  const nextRole = nextContext?.roles?.includes(state.role) ? state.role : nextContext?.roles?.[0] ?? state.role;
  if (state.token) {
    try {
      const body = await api("/api/v1/auth/context", {
        method: "POST",
        body: JSON.stringify({ category: nextCategory, role: nextRole }),
      });
      applyPrincipal(body.principal);
      await reload();
      setMessage(`${labels[state.role]}のカテゴリを切り替えました。`);
      return;
    } catch (error) {
      if (![403, 404].includes(error.status)) {
        elements.category.value = previousCategory;
        setMessage(error.message);
        return;
      }
      try { await api("/api/v1/auth/logout", { method: "POST" }); } catch {}
      clearSessionState();
    }
  }
  state.category = nextCategory;
  renderRoleOptions();
  try { await reload(); } catch (error) { setMessage(error.message); }
});

elements.role.addEventListener("change", async () => {
  if (!state.token) return;
  const previousRole = state.role;
  const nextRole = elements.role.value;
  try {
    const body = await api("/api/v1/auth/context", {
      method: "POST",
      body: JSON.stringify({ category: state.category, role: nextRole }),
    });
    applyPrincipal(body.principal);
    await reload();
    setMessage(`${labels[state.role]}へ表示を切り替えました。`);
  } catch (error) {
    elements.role.value = previousRole;
    setMessage(error.message);
  }
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
bindListFilters([elements.bookingStatusFilter], reloadBookings);
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
  if (state.token) return;
  const selected = elements.account.selectedOptions[0];
  const category = selected?.dataset.category;
  const role = selected?.dataset.role;
  if (category && state.categories.some((item) => item.slug === category)) {
    state.category = category;
    elements.category.value = category;
  }
  renderRoleOptions();
  if (role && Array.from(elements.role.options).some((option) => option.value === role)) {
    elements.role.value = role;
    state.role = role;
  }
});
elements.logout.addEventListener("click", logout);
elements.siteSeoAuditButton.addEventListener("click", () => void runSiteSeoAudit());
elements.mediaSeoAuditButton.addEventListener("click", () => void runMediaSeoAudit());
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

elements.bookingForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(elements.bookingForm);
  const localRequestedFor = String(form.get("requestedFor") ?? "");
  let requestedFor = "";
  try {
    requestedFor = new Date(localRequestedFor).toISOString();
  } catch {
    elements.bookingMessage.textContent = "希望日時を正しく指定してください。";
    return;
  }
  try {
    await api("/api/v1/bookings", {
      method: "POST",
      body: JSON.stringify({
        category: state.category,
        providerId: form.get("providerId"),
        menu: form.get("menu"),
        requestedFor,
        note: form.get("note"),
      }),
    });
    elements.bookingForm.reset();
    elements.bookingMessage.textContent = "予約リクエストを送信しました。店舗の確定をお待ちください。";
    await reloadBookings();
  } catch (error) {
    elements.bookingMessage.textContent = error.message;
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

elements.portalPlanningForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(elements.portalPlanningForm);
  try {
    const region = String(form.get("region") ?? "").trim();
    const body = await api("/api/v1/portal-plans", {
      method: "POST",
      body: JSON.stringify({
        category: state.category,
        theme: form.get("theme"),
        ...(region ? { region } : {}),
        audience: form.get("audience"),
        goal: form.get("goal"),
      }),
    });
    renderPortalPlan(body.item);
    setPortalPlanningMessage("ポータル企画を作成しました。内容を確認して下書きへ適用できます。");
    await reloadPortalPlanning();
    elements.portalPlanResult.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (error) {
    setPortalPlanningMessage(error.message);
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

elements.mediaManagementForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(elements.mediaManagementForm);
  try {
    await api("/api/v1/media", {
      method: "POST",
      body: JSON.stringify({
        category: state.category,
        name: form.get("name"),
        storageKey: form.get("storageKey"),
        mediaType: form.get("mediaType"),
        mimeType: form.get("mimeType"),
        sizeBytes: Number(form.get("sizeBytes")),
        altText: form.get("altText"),
        publicUrl: form.get("publicUrl") || undefined,
        rightsStatus: form.get("rightsStatus"),
        tags: String(form.get("tags") ?? "").split(",").map((tag) => tag.trim()).filter(Boolean),
      }),
    });
    elements.mediaManagementForm.reset();
    setMediaManagementMessage("メディアを登録しました。");
    await reloadMediaManagement();
  } catch (error) {
    setMediaManagementMessage(error.message);
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

elements.providerProfileClose.addEventListener("click", () => clearProviderProfile());
elements.providerProfileRequest.addEventListener("click", () => focusRequestForm(elements.providerProfileRequest.dataset.providerId ?? ""));
elements.providerProfileBooking.addEventListener("click", () => focusBookingForm(elements.providerProfileBooking.dataset.providerId ?? ""));
elements.providerProfileInquiry.addEventListener("click", () => {
  const providerId = elements.providerProfileInquiry.dataset.providerId ?? "";
  if (!providerId) return;
  elements.inquiryProvider.value = providerId;
  elements.inquiryForm.scrollIntoView({ behavior: "smooth", block: "center" });
});
elements.providerCompareRun.addEventListener("click", () => void loadProviderComparison());
elements.providerCompareClear.addEventListener("click", () => clearProviderComparison());

async function initialize() {
  try {
    await loadCategories();
  } catch (error) {
    setMessage(error.message);
  }
  await loadAuthConfig();
  await completeOidcCallback();
  await reload();
}

initialize().catch((error) => setMessage(error.message));
