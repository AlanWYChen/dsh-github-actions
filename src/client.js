/**
 * Client half of the GitHub Actions bundle — REQUIREMENTS.md §5.
 *
 * Loaded through the Harness module-loader contract. Only `react` is required.
 * The page talks to the Host through the authenticated `/api` bridge and keeps
 * polling `githubActions.snapshot` while it is mounted and visible.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-github-actions',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'github-actions';
    const PANEL_ID = 'github-actions';
    const STYLE_ID = 'gha-styles';
    const DEVICE_FLOW_SETTINGS_URL = 'https://github.com/settings/developers';

    // Browser services this module resolves through `ctx` at apply/registration
    // time. The page loader must mount the module after they are resolvable.
    const inject = ['slots', 'locale', 'connection'];

    /* ------------------------------------------------------------------ */
    /* Locale                                                              */
    /* ------------------------------------------------------------------ */

    const dictionaries = {
      en: {
        'meta.title': 'GitHub Actions',
        'meta.description': 'See the GitHub Actions runs currently running or queued for the selected workspace.',
        panelTitle: 'GitHub Actions',
        title: 'GitHub Actions',
        'repo.none': 'No GitHub repository connected',
        workspace: 'Workspace',
        refresh: 'Refresh',
        signOut: 'Sign out',
        retry: 'Retry',
        'error.banner': 'Could not refresh GitHub Actions',
        'error.hint': 'The last successful list is kept on screen. Retry when the connection is back.',
        'state.setup': 'Connect your GitHub OAuth App',
        'state.signedOut': 'Sign in with GitHub',
        'state.noCheckout': 'This workspace is not a git checkout',
        'state.noRemote': 'This checkout has no git remote',
        'state.notGithub': 'This checkout is not a GitHub repository',
        'state.ready': 'Active workflow runs',
        'state.error': 'GitHub Actions is unavailable',
        loading: 'Loading runs…',
        'setup.intro': 'Create a GitHub OAuth App once, then paste its Client ID here. The device flow does not need a client secret.',
        'setup.step1': 'Open GitHub → Settings → Developer settings → OAuth Apps → New OAuth App.',
        'setup.step2': 'Fill in the fields below, tick Enable Device Flow, and register the application.',
        'setup.step3': 'Copy the app Client ID and paste it into this panel, then Save.',
        'setup.homepageLabel': 'Homepage URL',
        'setup.homepageValue': 'http://127.0.0.1:3080',
        'setup.callbackLabel': 'Authorization callback URL',
        'setup.callbackValue': 'http://127.0.0.1:3080',
        'setup.deviceFlowLabel': 'Expire user access tokens',
        'setup.deviceFlowValue': 'Leave disabled for the prototype; a non-expiring token keeps the panel connected.',
        'setup.tokenExpiryLabel': 'If token expiry is enabled',
        'setup.tokenExpiryValue': 'Tokens last 8 hours and device flow returns no refresh token. Sign out and sign in again from the panel after expiry.',
        'setup.clientIdLabel': 'OAuth App Client ID',
        'setup.placeholder': 'Iv1.0123456789abcdef',
        'setup.save': 'Save',
        'setup.saving': 'Saving…',
        'signedOut.hint': 'Sign in with GitHub to read the active workflow runs for this repository.',
        signIn: 'Sign in with GitHub',
        'signIn.userCode': 'Enter this code on GitHub:',
        'signIn.open': 'Open GitHub',
        'signIn.pending': 'Waiting for GitHub authorization…',
        'signIn.cancel': 'Cancel',
        'signIn.expired': 'The sign-in code expired. Start again.',
        'signIn.denied': 'GitHub authorization was declined.',
        'signIn.enableDeviceFlow': 'Open OAuth App settings and enable Device Flow',
        'noCheckout.hint': 'Open a folder that contains a git checkout with a GitHub remote.',
        'noRemote.hint': 'Add a GitHub remote (for example git remote add origin git@github.com:owner/name.git) and refresh.',
        'notGithub.hint': 'This checkout only has non-GitHub remotes. Add a GitHub remote and refresh.',
        'repoHints.common': 'The panel reads the repository from the workspace selected in the sidebar.',
        empty: 'No runs are currently running.',
        'section.running': 'Running',
        'section.recent': 'Recent',
        'empty.history': 'No finished runs yet.',
        'conclusion.success': 'Success',
        'conclusion.failure': 'Failed',
        'conclusion.cancelled': 'Cancelled',
        'conclusion.skipped': 'Skipped',
        'conclusion.neutral': 'Neutral',
        'conclusion.timed_out': 'Timed out',
        'conclusion.action_required': 'Action required',
        'conclusion.unknown': 'Unknown',
        'header.name': 'Name',
        'header.workflow': 'Workflow',
        'header.branch': 'Branch',
        'header.event': 'Event',
        'header.status': 'Status',
        'header.completed': 'Completed',
        'a11y.runningList': 'Running workflow runs',
        'a11y.recentList': 'Recent finished runs',
        'a11y.openRepo': 'Open repository on GitHub',
        'stale.warning': 'Showing the last successful list; GitHub could not be refreshed.',
        'pill.running': 'Running',
        'pill.queued': 'Queued',
        'time.justNow': 'just now',
        'time.minutesAgo': '{count}m ago',
        'time.hoursAgo': '{count}h ago',
        'time.daysAgo': '{count}d ago',
      },
      zh: {
        'meta.title': 'GitHub Actions',
        'meta.description': '查看所选工作区当前正在运行或排队的 GitHub Actions 工作流。',
        panelTitle: 'GitHub Actions',
        title: 'GitHub Actions',
        'repo.none': '未连接 GitHub 仓库',
        workspace: '工作区',
        refresh: '刷新',
        signOut: '退出登录',
        retry: '重试',
        'error.banner': '无法刷新 GitHub Actions',
        'error.hint': '最后一次成功列表仍保留在屏幕上。连接恢复后可重试。',
        'state.setup': '连接你的 GitHub OAuth 应用',
        'state.signedOut': '使用 GitHub 登录',
        'state.noCheckout': '此工作区不是 git 检出',
        'state.noRemote': '此检出没有 git 远程',
        'state.notGithub': '此检出不是 GitHub 仓库',
        'state.ready': '正在运行的工作流',
        'state.error': 'GitHub Actions 暂不可用',
        loading: '正在加载运行…',
        'setup.intro': '只需创建一次 GitHub OAuth 应用，然后把它的 Client ID 粘贴到这里。设备流不需要客户端密钥。',
        'setup.step1': '打开 GitHub → Settings → Developer settings → OAuth Apps → New OAuth App。',
        'setup.step2': '按下表填写字段，勾选 Enable Device Flow，然后注册应用。',
        'setup.step3': '复制应用的 Client ID，粘贴到此面板并保存。',
        'setup.homepageLabel': '主页 URL',
        'setup.homepageValue': 'http://127.0.0.1:3080',
        'setup.callbackLabel': '授权回调 URL',
        'setup.callbackValue': 'http://127.0.0.1:3080',
        'setup.deviceFlowLabel': '用户访问令牌过期',
        'setup.deviceFlowValue': '原型阶段保持禁用；永不过期的令牌可以让面板保持连接。',
        'setup.tokenExpiryLabel': '如果启用令牌过期',
        'setup.tokenExpiryValue': '令牌有效期为 8 小时，设备流不会返回刷新令牌。过期后请从面板退出并重新登录。',
        'setup.clientIdLabel': 'OAuth 应用 Client ID',
        'setup.placeholder': 'Iv1.0123456789abcdef',
        'setup.save': '保存',
        'setup.saving': '正在保存…',
        'signedOut.hint': '使用 GitHub 登录以读取此仓库正在运行的工作流。',
        signIn: '使用 GitHub 登录',
        'signIn.userCode': '在 GitHub 上输入此代码：',
        'signIn.open': '打开 GitHub',
        'signIn.pending': '等待 GitHub 授权…',
        'signIn.cancel': '取消',
        'signIn.expired': '登录代码已过期，请重新开始。',
        'signIn.denied': 'GitHub 授权已被拒绝。',
        'signIn.enableDeviceFlow': '打开 OAuth 应用设置并启用设备流',
        'noCheckout.hint': '请打开一个包含 git 检出且配置了 GitHub 远程的文件夹。',
        'noRemote.hint': '添加 GitHub 远程（例如 git remote add origin git@github.com:owner/name.git）后刷新。',
        'notGithub.hint': '此检出只有非 GitHub 远程。请添加 GitHub 远程后刷新。',
        'repoHints.common': '面板会从侧边栏所选工作区读取仓库。',
        empty: '当前没有正在运行的工作流。',
        'section.running': '运行中',
        'section.recent': '最近完成',
        'empty.history': '暂无已完成的运行。',
        'conclusion.success': '成功',
        'conclusion.failure': '失败',
        'conclusion.cancelled': '已取消',
        'conclusion.skipped': '已跳过',
        'conclusion.neutral': '中性',
        'conclusion.timed_out': '超时',
        'conclusion.action_required': '需要操作',
        'conclusion.unknown': '未知',
        'header.name': '名称',
        'header.workflow': '工作流',
        'header.branch': '分支',
        'header.event': '事件',
        'header.status': '状态',
        'header.completed': '完成时间',
        'a11y.runningList': '正在运行的工作流列表',
        'a11y.recentList': '最近完成的工作流列表',
        'a11y.openRepo': '在 GitHub 上打开仓库',
        'stale.warning': '正在显示最后一次成功的列表；GitHub 暂时无法刷新。',
        'pill.running': '运行中',
        'pill.queued': '排队中',
        'time.justNow': '刚刚',
        'time.minutesAgo': '{count} 分钟前',
        'time.hoursAgo': '{count} 小时前',
        'time.daysAgo': '{count} 天前',
      },
    };

    /* ------------------------------------------------------------------ */
    /* Pure view model                                                     */
    /* ------------------------------------------------------------------ */

    function describeState(snapshot) {
      if (snapshot === null || snapshot === undefined || typeof snapshot !== 'object') {
        return { kind: 'error', titleKey: 'state.error' };
      }

      const auth = snapshot.auth !== null && typeof snapshot.auth === 'object' ? snapshot.auth : {};

      if (!auth.clientIdConfigured) return { kind: 'setup', titleKey: 'state.setup' };
      if (!auth.signedIn) return { kind: 'signed-out', titleKey: 'state.signedOut' };

      switch (snapshot.repoStatus) {
        case 'no-checkout':
          return { kind: 'no-checkout', titleKey: 'state.noCheckout' };
        case 'no-remote':
          return { kind: 'no-remote', titleKey: 'state.noRemote' };
        case 'not-github':
          return { kind: 'not-github', titleKey: 'state.notGithub' };
        case 'ok':
          return { kind: 'ready', titleKey: 'state.ready' };
        default:
          // `no-git` and any unexpected status are Host RPC errors, not
          // Snapshot.repoStatus values; render the error surface rather than
          // assuming a body state.
          return { kind: 'error', titleKey: 'state.error' };
      }
    }

    function nextPollDelay(config) {
      const raw = config !== null && typeof config === 'object' ? config : {};
      const refreshMs = Number(raw.refreshMs);
      const pollMs = Number(raw.pollMs);
      const minimum = Number.isFinite(refreshMs) && refreshMs >= 0 ? refreshMs : 3000;
      const value = Number.isFinite(pollMs) && pollMs >= 0 ? pollMs : 5000;

      return Math.max(value, minimum);
    }

    function visibleRuns(snapshot) {
      return snapshot !== null &&
        typeof snapshot === 'object' &&
        Array.isArray(snapshot.runs)
        ? snapshot.runs
        : [];
    }

    function unwrapResult(result) {
      if (result !== null && typeof result === 'object' && typeof result.ok === 'boolean') {
        if (result.ok) return result.value;

        const error = new Error(
          result.error !== null &&
            typeof result.error === 'object' &&
            typeof result.error.message === 'string'
            ? result.error.message
            : 'RPC failed',
        );

        error.code =
          result.error !== null &&
          typeof result.error === 'object' &&
          typeof result.error.code === 'string'
            ? result.error.code
            : undefined;

        throw error;
      }

      return result;
    }

    function formatRelative(value, t) {
      const timestamp = typeof value === 'string' ? Date.parse(value) : NaN;

      if (!Number.isFinite(timestamp)) return '';

      const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));

      if (seconds < 45) return t('time.justNow');

      const minutes = Math.max(1, Math.round(seconds / 60));

      if (minutes < 60) return t('time.minutesAgo', { count: minutes });

      const hours = Math.round(minutes / 60);

      if (hours < 24) return t('time.hoursAgo', { count: hours });

      return t('time.daysAgo', { count: Math.round(hours / 24) });
    }

    function openInNewTab(url) {
      if (typeof url !== 'string' || url.length === 0) return;

      try {
        if (typeof window !== 'undefined' && typeof window.open === 'function') {
          window.open(url, '_blank', 'noopener,noreferrer');

          return;
        }
      } catch {
        /* fall through to the bare browser global */
      }

      try {
        if (typeof open === 'function') open(url, '_blank');
      } catch {
        /* no navigable environment */
      }
    }

    /* ------------------------------------------------------------------ */
    /* Original artwork and scoped styles                                  */
    /* ------------------------------------------------------------------ */

    const CSS = `
.gha-page{box-sizing:border-box;display:flex;flex-direction:column;height:100%;min-height:0;gap:16px;padding:20px;color:var(--dsw-alias-label-primary);font:inherit}
.gha-toolbar{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.gha-toolbar-main{display:flex;align-items:center;gap:12px;flex-wrap:wrap;min-width:0}
.gha-title{margin:0;font-size:18px;font-weight:600;letter-spacing:-0.01em}
.gha-repo{color:var(--dsw-alias-brand-primary);text-decoration:none}
.gha-repo:hover{text-decoration:underline}
.gha-repo-none{color:var(--dsw-alias-label-secondary)}
.gha-toolbar-actions{display:flex;align-items:center;gap:8px}
.gha-repo-select{min-width:240px;max-width:360px;width:auto;text-overflow:ellipsis;height:32px}
.gha-repo-link{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);text-decoration:none;white-space:nowrap;font-size:13px}
.gha-repo-link:hover{background:var(--dsw-alias-interactive-bg-hover)}
.gha-repo-icon{display:block;flex:none;line-height:1}
.gha-loading{display:flex;align-items:center;justify-content:center;padding:32px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:13px}
.gha-button{appearance:none;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;padding:6px 12px;cursor:pointer;transition:background-color .15s ease,border-color .15s ease}
.gha-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.gha-button:focus-visible,.gha-run:focus-visible,.gha-input:focus-visible,.gha-select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.gha-button:disabled{opacity:.55;cursor:default}
.gha-button-primary{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-inverted)}
.gha-button-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.gha-button-quiet{border-color:transparent;background:transparent;color:var(--dsw-alias-label-secondary)}
.gha-banner{display:flex;align-items:center;gap:12px;flex-wrap:wrap;border:1px solid var(--dsw-alias-state-warn-secondary);background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-label);border-radius:8px;padding:8px 12px;font-size:13px}
.gha-body{min-width:0;flex:1;min-height:0;display:flex;flex-direction:column}
.gha-runs{flex:1;min-height:0;display:flex;flex-direction:column;gap:16px}
.gha-state{display:flex;flex-direction:column;gap:10px;max-width:640px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2);padding:20px}
.gha-state-title{margin:0;font-size:15px;font-weight:600}
.gha-state p{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.5}
.gha-steps{margin:0;padding-left:20px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.6}
.gha-fields{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px;margin:0;font-size:12px}
.gha-fields dt{color:var(--dsw-alias-label-secondary)}
.gha-fields dd{margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-primary)}
.gha-form{display:flex;align-items:flex-end;gap:8px;flex-wrap:wrap;margin-top:4px}
.gha-field-label{flex:1 1 240px;display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.gha-input,.gha-select{font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 10px;min-width:200px}
.gha-signin{display:flex;flex-direction:column;gap:8px;align-items:flex-start}
.gha-user-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:18px;letter-spacing:.12em;border:1px dashed var(--dsw-alias-border-l2);border-radius:8px;padding:6px 12px;background:var(--dsw-alias-bg-layer-1)}
.gha-link{color:var(--dsw-alias-brand-primary)}
.gha-pending{color:var(--dsw-alias-label-secondary)}
.gha-list{display:flex;flex-direction:column;gap:8px;padding:10px 14px 14px}
.gha-run,.gha-header{display:grid;grid-template-columns:minmax(0, 1fr) 140px 140px 110px 96px 132px;align-items:center;gap:12px}
.gha-run{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:10px 14px;cursor:pointer;transition:border-color .15s ease,background-color .15s ease}
.gha-run:hover{background:var(--dsw-alias-interactive-bg-hover)}
.gha-run-name{font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gha-run-workflow,.gha-run-branch,.gha-run-event,.gha-run-time{font-size:12px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gha-pill{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;justify-self:center;min-width:112px;font-size:11px;font-weight:600;border-radius:999px;padding:2px 9px;border:1px solid var(--dsw-alias-border-l2);white-space:nowrap}
.gha-pill-running{border-color:var(--dsw-alias-state-success-secondary);background:var(--dsw-alias-state-success-tertiary);color:var(--dsw-alias-state-success-primary)}
.gha-pill-running::before{content:"";width:6px;height:6px;border-radius:999px;background:currentColor;animation:gha-pulse 1.2s ease-in-out infinite}
.gha-pill-queued{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.gha-stale{font-size:12px;color:var(--dsw-alias-state-warn-label);margin:0}
.gha-empty{max-width:none}
.gha-section{display:flex;flex-direction:column;gap:8px;min-width:0}
.gha-scroll{box-sizing:border-box;overflow-y:auto;max-height:min(52vh, 640px);scrollbar-width:thin;scrollbar-color:var(--dsw-alias-border-l2) var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:0 0 10px}
.gha-recent{flex:1;min-height:0}
.gha-recent .gha-scroll{flex:1;min-height:0;max-height:none}
.gha-running .gha-scroll{max-height:40vh}
.gha-scroll::-webkit-scrollbar{width:8px}
.gha-scroll::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2);border-radius:8px}
.gha-scroll::-webkit-scrollbar-track{background:var(--dsw-alias-bg-layer-1)}
.gha-section-title{position:sticky;top:0;z-index:1;margin:0;padding:8px 14px;font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1)}
.gha-header{padding:6px 28px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.gha-header-cell{font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gha-empty-wrap{padding:10px 14px 14px}
.gha-empty-line{margin:0;padding:14px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:13px}
.gha-history-warning{margin:0;padding:0 28px;font-size:12px;color:var(--dsw-alias-state-warn-label)}
.gha-pill-success{border-color:var(--dsw-alias-state-success-secondary);background:var(--dsw-alias-state-success-tertiary);color:var(--dsw-alias-state-success-primary)}
.gha-pill-failure{border-color:var(--dsw-alias-state-warn-secondary);background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-label)}
.gha-pill-neutral{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
@keyframes gha-pulse{0%,100%{opacity:.35}50%{opacity:1}}
@media (prefers-reduced-motion:reduce){.gha-pill-running::before{animation:none}}
@media (max-width:720px){.gha-run,.gha-header{grid-template-columns:minmax(0,1fr) 120px 96px 120px}.gha-run-branch,.gha-run-event,.gha-header-branch,.gha-header-event{display:none}}
`;

    function installStyles() {
      const doc =
        typeof document !== 'undefined'
          ? document
          : typeof window !== 'undefined'
            ? window.document
            : undefined;

      if (doc === undefined || doc === null || typeof doc.createElement !== 'function') {
        return undefined;
      }

      const host = doc.head ?? doc.body;

      if (host === undefined || host === null || typeof host.appendChild !== 'function') {
        return undefined;
      }

      let existing;

      try {
        existing = typeof doc.getElementById === 'function' ? doc.getElementById(STYLE_ID) : null;
      } catch {
        existing = null;
      }

      if (existing !== null && existing !== undefined) return undefined;

      const style = doc.createElement('style');

      style.id = STYLE_ID;

      if (typeof style.setAttribute === 'function') {
        style.setAttribute('data-dsh-plugin', PANEL_ID);
      }

      style.textContent = CSS;
      host.appendChild(style);

      return () => {
        if (style.parentNode !== undefined && style.parentNode !== null) {
          if (typeof style.parentNode.removeChild === 'function') {
            style.parentNode.removeChild(style);
          }
        }
      };
    }

    function GitHubActionsIcon() {
      return h(
        'svg',
        {
          className: 'gha-icon',
          viewBox: '0 0 24 24',
          width: 18,
          height: 18,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        h('circle', { cx: 12, cy: 12, r: 9 }),
        h('path', { d: 'M10 8.2l5.2 3.8L10 15.8z' }),
        h('path', { d: 'M4.6 14.6a9 9 0 0 0 14.4 2.2', opacity: 0.5 }),
      );
    }

    /* ------------------------------------------------------------------ */
    /* Page component                                                      */
    /* ------------------------------------------------------------------ */

    const rpcFallback = async () => {
      throw new Error('The Harness RPC connection is unavailable.');
    };

    function normalizeClientConfig(input) {
      const raw = input !== null && typeof input === 'object' ? input : {};
      const refreshMs = Number(raw.refreshMs);
      const pollMs = Number(raw.pollMs);

      return {
        ...raw,
        refreshMs: Number.isFinite(refreshMs) && refreshMs >= 0 ? refreshMs : 3000,
        pollMs: Number.isFinite(pollMs) && pollMs >= 0 ? pollMs : 5000,
      };
    }

    const WORKSPACE_STORAGE_KEY = 'github-actions.workspace';

    function browserStorage() {
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          return window.localStorage;
        }
      } catch {
        /* storage access can throw in hardened browsers */
      }

      try {
        if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
      } catch {
        /* storage access can throw in hardened browsers */
      }

      return undefined;
    }

    function readStoredWorkspaceId() {
      try {
        const storage = browserStorage();

        if (storage === undefined) return undefined;

        const value = storage.getItem(WORKSPACE_STORAGE_KEY);

        return typeof value === 'string' && value.length > 0 ? value : undefined;
      } catch {
        return undefined;
      }
    }

    function writeStoredWorkspaceId(id) {
      try {
        const storage = browserStorage();

        if (storage !== undefined) storage.setItem(WORKSPACE_STORAGE_KEY, id);
      } catch {
        /* workspace memory is best-effort */
      }
    }

    function initialWorkspaceId(items, fallback) {
      const ids = items.map((item) => String(item.workspaceId ?? item.id ?? ''));
      const stored = readStoredWorkspaceId();

      if (stored !== undefined && ids.includes(stored)) return stored;

      return ids[0] ?? (typeof fallback === 'string' ? fallback : null);
    }

    // §25/§26: one snapshot cache and one per-workspace token sequence per client
    // module instance. The cache survives panel unmount/remount, is dropped by a
    // page reload, is never persisted, and is bounded to 20 entries.
    const snapshotCache = new Map();
    const latestRequestTokens = new Map();
    let requestTokenSequence = 0;

    function nextSnapshotRequestToken(workspaceId) {
      requestTokenSequence += 1;
      latestRequestTokens.set(String(workspaceId), requestTokenSequence);

      return requestTokenSequence;
    }

    function isLatestSnapshotRequest(workspaceId, token) {
      return latestRequestTokens.get(String(workspaceId)) === token;
    }

    function cacheSnapshot(workspaceId, value) {
      snapshotCache.set(String(workspaceId), value);

      while (snapshotCache.size > 20) {
        const oldest = snapshotCache.keys().next().value;

        snapshotCache.delete(oldest);
      }
    }

    function GitHubActionsPage(props) {
      const config = normalizeClientConfig(props.config);
      const pollMs = nextPollDelay(config);
      const t = typeof props.t === 'function' ? props.t : (key) => key;
      const rpcCall = typeof props.rpc === 'function' ? props.rpc : rpcFallback;

      const workspaceSnapshot =
        typeof props.useWorkspaces === 'function'
          ? props.useWorkspaces((value) => value)
          : null;
      const declaredWorkspaces = Array.isArray(props.workspaces) ? props.workspaces : [];
      const workspaceItems =
        declaredWorkspaces.length > 0
          ? declaredWorkspaces
          : Array.isArray(workspaceSnapshot?.items)
            ? workspaceSnapshot.items
            : [];

      const [status, setStatus] = React.useState(null);
      const [selectedWorkspaceId, setSelectedWorkspaceId] = React.useState(() =>
        initialWorkspaceId(workspaceItems, props.workspaceId),
      );
      const [snapshot, setSnapshot] = React.useState(() => {
        const id =
          selectedWorkspaceId ??
          props.workspaceId ??
          workspaceItems[0]?.workspaceId ??
          workspaceItems[0]?.id ??
          null;
        const cached = id === null || id === undefined ? undefined : snapshotCache.get(String(id));

        return cached ?? null;
      });
      const [loadError, setLoadError] = React.useState(null);
      const [clientIdDraft, setClientIdDraft] = React.useState('');
      const [signIn, setSignIn] = React.useState(null);
      const [busy, setBusy] = React.useState(false);

      const activeWorkspaceId =
        selectedWorkspaceId ??
        props.workspaceId ??
        workspaceItems[0]?.workspaceId ??
        workspaceItems[0]?.id ??
        null;

      const activeWorkspaceIdRef = React.useRef(activeWorkspaceId);

      activeWorkspaceIdRef.current = activeWorkspaceId;

      const loadStatus = React.useCallback(async () => {
        try {
          const value = unwrapResult(await rpcCall('githubActions.status', {}));

          setStatus(value ?? null);

          return value ?? null;
        } catch (error) {
          setLoadError(error);

          return null;
        }
      }, [rpcCall]);

      const loadSnapshot = React.useCallback(
        async (options) => {
          const requestWorkspaceId = activeWorkspaceId;

          if (requestWorkspaceId === null || requestWorkspaceId === undefined) return null;

          // §26: monotonically increasing token per workspace. Only the latest
          // issued read may apply to state, cache, or the error banner.
          const requestToken = nextSnapshotRequestToken(requestWorkspaceId);

          try {
            const payload = { workspaceId: requestWorkspaceId };

            if (options !== null && typeof options === 'object' && options.refresh === true) {
              payload.refresh = true;
            }

            const value = unwrapResult(
              await rpcCall('githubActions.snapshot', payload),
            );

            // A response for a workspace the user already left must not replace
            // the panel or pollute the cache.
            if (activeWorkspaceIdRef.current !== requestWorkspaceId) return value ?? null;

            if (!isLatestSnapshotRequest(requestWorkspaceId, requestToken)) {
              return value ?? null;
            }

            setSnapshot(value ?? null);
            setLoadError(null);

            if (value !== null && value !== undefined) {
              cacheSnapshot(requestWorkspaceId, value);
            }

            return value ?? null;
          } catch (error) {
            if (activeWorkspaceIdRef.current !== requestWorkspaceId) return null;

            if (!isLatestSnapshotRequest(requestWorkspaceId, requestToken)) return null;

            setLoadError(error);

            return null;
          }
        },
        [rpcCall, activeWorkspaceId],
      );

      React.useEffect(() => {
        void loadStatus();
      }, [loadStatus]);

      React.useEffect(() => {
        let cancelled = false;
        let timer = null;

        const isHidden = () =>
          typeof document !== 'undefined' && document.visibilityState === 'hidden';

        const schedule = () => {
          if (cancelled) return;
          if (timer !== null) {
            clearTimeout(timer);
            timer = null;
          }
          if (isHidden()) return;
          timer = setTimeout(() => {
            void tick();
          }, pollMs);
        };

        const tick = async () => {
          timer = null;
          await loadSnapshot();
          if (!cancelled) schedule();
        };

        if (!isHidden()) void tick();

        const onVisibilityChange = () => {
          if (cancelled) return;

          if (isHidden()) {
            if (timer !== null) {
              clearTimeout(timer);
              timer = null;
            }

            return;
          }

          if (timer === null) void tick();
        };

        if (
          typeof document !== 'undefined' &&
          typeof document.addEventListener === 'function'
        ) {
          document.addEventListener('visibilitychange', onVisibilityChange);
        }

        return () => {
          cancelled = true;

          if (timer !== null) {
            clearTimeout(timer);
            timer = null;
          }

          if (
            typeof document !== 'undefined' &&
            typeof document.removeEventListener === 'function'
          ) {
            document.removeEventListener('visibilitychange', onVisibilityChange);
          }
        };
      }, [loadSnapshot, pollMs]);

      React.useEffect(() => {
        if (signIn === null || signIn.pending !== true) return undefined;

        let cancelled = false;
        let timer = null;
        let intervalSeconds = Math.max(1, Number(signIn.interval) || 5);

        const tick = async () => {
          timer = null;

          try {
            const value = unwrapResult(await rpcCall('githubActions.poll', {}));

            if (cancelled) return;

            if (value !== null && typeof value === 'object' && value.state === 'pending') {
              intervalSeconds = Math.max(1, Number(value.interval) || intervalSeconds);
              setSignIn((current) =>
                current === null ? current : { ...current, interval: intervalSeconds },
              );
              timer = setTimeout(() => {
                void tick();
              }, intervalSeconds * 1000);

              return;
            }

            if (value !== null && typeof value === 'object' && value.state === 'authorized') {
              setSignIn(null);
              await loadStatus();
              await loadSnapshot({ refresh: true });

              return;
            }

            setSignIn(null);
            setLoadError(
              new Error(
                value !== null && typeof value === 'object' && value.state === 'expired'
                  ? t('signIn.expired')
                  : t('signIn.denied'),
              ),
            );
          } catch (error) {
            if (!cancelled) {
              setSignIn(null);
              setLoadError(error);
            }
          }
        };

        timer = setTimeout(() => {
          void tick();
        }, intervalSeconds * 1000);

        return () => {
          cancelled = true;
          if (timer !== null) {
            clearTimeout(timer);
            timer = null;
          }
        };
      }, [signIn?.deviceCode, rpcCall, loadStatus, loadSnapshot, t]);

      const handleRefresh = () => {
        void loadSnapshot({ refresh: true });
      };

      const handleSaveClientId = async (event) => {
        if (event !== null && typeof event === 'object' && typeof event.preventDefault === 'function') {
          event.preventDefault();
        }
        if (busy) return;

        setBusy(true);

        try {
          const value = unwrapResult(
            await rpcCall('githubActions.setClientId', { clientId: clientIdDraft }),
          );

          setStatus(value ?? null);
          await loadStatus();
          await loadSnapshot({ refresh: true });
        } catch (error) {
          setLoadError(error);
        } finally {
          setBusy(false);
        }
      };

      const handleBeginSignIn = async () => {
        setLoadError(null);

        try {
          const value = unwrapResult(await rpcCall('githubActions.begin', {}));

          setSignIn({ ...value, pending: true });
        } catch (error) {
          setLoadError(error);
        }
      };

      const handleCancelSignIn = async () => {
        setSignIn(null);

        try {
          const value = unwrapResult(await rpcCall('githubActions.cancel', {}));

          setStatus(value ?? null);
        } catch (error) {
          setLoadError(error);
        }
      };

      const handleSignOut = async () => {
        try {
          const value = unwrapResult(await rpcCall('githubActions.signOut', {}));

          setStatus(value ?? null);
          await loadSnapshot({ refresh: true });
        } catch (error) {
          setLoadError(error);
        }
      };

      const handleWorkspaceChange = (event) => {
        const next =
          event !== null && typeof event === 'object' && event.target !== undefined
            ? event.target.value
            : undefined;

        if (typeof next === 'string' && next.length > 0) {
          setSelectedWorkspaceId(next);
          writeStoredWorkspaceId(next);
          setLoadError(null);

          const cached = snapshotCache.get(String(next));

          // A cache hit renders immediately (no loading/blank); a miss shows the
          // loading state until the fresh read settles.
          setSnapshot(cached ?? null);
        }
      };

      const effectiveAuth =
        status !== null && typeof status === 'object'
          ? status
          : snapshot !== null && typeof snapshot === 'object'
            ? snapshot.auth
            : null;
      const viewSnapshot =
        snapshot === null || typeof snapshot !== 'object'
          ? null
          : activeAuthSnapshot(snapshot, effectiveAuth);
      const state = describeState(viewSnapshot);
      const repo = viewSnapshot !== null ? viewSnapshot.repo : null;
      const runs = visibleRuns(viewSnapshot);
      const loading = snapshot === null && loadError === null;

      const repoLink =
        repo !== null && repo !== undefined
          ? h(
              'a',
              {
                className: 'gha-repo-link',
                href: repo.webUrl,
                target: '_blank',
                rel: 'noreferrer noopener',
                'aria-label': t('a11y.openRepo'),
              },
              h(
                'svg',
                {
                  className: 'gha-repo-icon',
                  viewBox: '0 0 16 16',
                  width: 16,
                  height: 16,
                  fill: 'none',
                  stroke: 'currentColor',
                  strokeWidth: 1.6,
                  strokeLinecap: 'round',
                  strokeLinejoin: 'round',
                  'aria-hidden': 'true',
                  focusable: 'false',
                },
                h('path', { d: 'M6 3H3v10h10V9' }),
                h('path', { d: 'M9 3h4v4' }),
                h('path', { d: 'M13 3 7.5 8.5' }),
              ),
              h('span', { className: 'gha-repo-slug' }, repo.slug),
            )
          : null;

      const workspaceSelect =
        workspaceItems.length === 0
          ? null
          : h(
              'select',
              {
                className: 'gha-select gha-repo-select',
                value: activeWorkspaceId ?? '',
                'aria-label': t('workspace'),
                onChange: handleWorkspaceChange,
              },
              workspaceItems.map((item) => {
                const id = String(item.workspaceId ?? item.id ?? '');
                const selected = id === String(activeWorkspaceId ?? '');

                return h(
                  'option',
                  { key: id, value: id, selected },
                  item.title ?? item.path ?? id,
                );
              }),
            );

      const toolbar = h(
        'header',
        { className: 'gha-toolbar' },
        h(
          'div',
          { className: 'gha-toolbar-main' },
          h('h2', { className: 'gha-title' }, t('title')),
          workspaceSelect,
          repoLink,
        ),
        h(
          'div',
          { className: 'gha-toolbar-actions' },
          h(
            'button',
            { type: 'button', className: 'gha-button', onClick: handleRefresh },
            t('refresh'),
          ),
          effectiveAuth !== null &&
            typeof effectiveAuth === 'object' &&
            effectiveAuth.signedIn === true
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'gha-button gha-button-quiet',
                  onClick: handleSignOut,
                },
                t('signOut'),
              )
            : null,
        ),
      );

      const banner =
        loadError !== null
          ? h(
              'div',
              { className: 'gha-banner', role: 'status' },
              h(
                'span',
                { className: 'gha-banner-text' },
                `${t('error.banner')}: ${
                  typeof loadError?.message === 'string' ? loadError.message : ''
                }`,
              ),
              loadError?.code === 'device-flow-disabled'
                ? h(
                    'a',
                    {
                      className: 'gha-link',
                      href: DEVICE_FLOW_SETTINGS_URL,
                      target: '_blank',
                      rel: 'noreferrer noopener',
                    },
                    t('signIn.enableDeviceFlow'),
                  )
                : null,
              h(
                'button',
                {
                  type: 'button',
                  className: 'gha-button',
                  onClick: () => {
                    setLoadError(null);
                    void loadSnapshot();
                  },
                },
                t('retry'),
              ),
            )
          : null;

      const conclusionKeyOf = (conclusion) => {
        switch (conclusion) {
          case 'success':
            return 'conclusion.success';
          case 'failure':
            return 'conclusion.failure';
          case 'cancelled':
            return 'conclusion.cancelled';
          case 'skipped':
            return 'conclusion.skipped';
          case 'neutral':
            return 'conclusion.neutral';
          case 'timed_out':
            return 'conclusion.timed_out';
          case 'action_required':
            return 'conclusion.action_required';
          default:
            return 'conclusion.unknown';
        }
      };

      const conclusionToneOf = (conclusion) => {
        if (conclusion === 'success') return 'success';
        if (
          conclusion === 'failure' ||
          conclusion === 'timed_out' ||
          conclusion === 'action_required'
        ) {
          return 'failure';
        }

        return 'neutral';
      };

      const activateOnKeyDown = (event, url) => {
        const key = event !== null && typeof event === 'object' ? event.key : undefined;

        if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
          if (
            event !== null &&
            typeof event === 'object' &&
            typeof event.preventDefault === 'function'
          ) {
            event.preventDefault();
          }
          openInNewTab(url);
        }
      };

      const renderRunRow = (run) => {
        const running = run.status !== 'queued';

        return h(
          'div',
          {
            key: String(run.id),
            className: `gha-run ${running ? 'gha-run-active' : 'gha-run-queued'}`,
            role: 'listitem',
            tabIndex: 0,
            title: run.htmlUrl,
            'data-gha-run-id': String(run.id),
            onClick: () => openInNewTab(run.htmlUrl),
            onKeyDown: (event) => activateOnKeyDown(event, run.htmlUrl),
          },
          h('span', { className: 'gha-run-name' }, run.name),
          h('span', { className: 'gha-run-workflow' }, run.workflowName),
          h('span', { className: 'gha-run-branch' }, run.branch ?? ''),
          h('span', { className: 'gha-run-event' }, run.event ?? ''),
          h(
            'span',
            { className: 'gha-run-time' },
            formatRelative(run.startedAt ?? run.createdAt, t),
          ),
          h(
            'span',
            {
              className: `gha-pill ${running ? 'gha-pill-running' : 'gha-pill-queued'}`,
            },
            t(running ? 'pill.running' : 'pill.queued'),
          ),
        );
      };

      const renderHistoryRow = (entry) => {
        const tone = conclusionToneOf(entry.conclusion);

        return h(
          'div',
          {
            key: String(entry.id),
            className: 'gha-run gha-run-history',
            role: 'listitem',
            tabIndex: 0,
            title: entry.htmlUrl,
            'data-gha-run-id': String(entry.id),
            onClick: () => openInNewTab(entry.htmlUrl),
            onKeyDown: (event) => activateOnKeyDown(event, entry.htmlUrl),
          },
          h('span', { className: 'gha-run-name' }, entry.name),
          h('span', { className: 'gha-run-workflow' }, entry.workflowName),
          h('span', { className: 'gha-run-branch' }, entry.branch ?? ''),
          h('span', { className: 'gha-run-event' }, entry.event ?? ''),
          h(
            'span',
            { className: 'gha-run-time' },
            formatRelative(entry.completedAt ?? entry.startedAt ?? entry.createdAt, t),
          ),
          h(
            'span',
            { className: `gha-pill gha-pill-${tone}` },
            t(conclusionKeyOf(entry.conclusion)),
          ),
        );
      };

      const renderHeader = (recent) =>
        h(
          'div',
          { className: 'gha-header', role: 'presentation', 'aria-hidden': 'true' },
          h('span', { className: 'gha-header-cell' }, t('header.name')),
          h('span', { className: 'gha-header-cell' }, t('header.workflow')),
          h(
            'span',
            { className: 'gha-header-cell gha-header-branch' },
            t('header.branch'),
          ),
          h('span', { className: 'gha-header-cell gha-header-event' }, t('header.event')),
          recent
            ? h('span', { className: 'gha-header-cell' }, t('header.completed'))
            : h('span', { className: 'gha-header-cell' }),
          h('span', { className: 'gha-header-cell' }, t('header.status')),
        );

      const renderRepoIssue = () => {
        const hintKey =
          state.kind === 'no-checkout'
            ? 'noCheckout.hint'
            : state.kind === 'no-remote'
              ? 'noRemote.hint'
              : 'notGithub.hint';

        return h(
          'div',
          { className: 'gha-state' },
          h('h3', { className: 'gha-state-title' }, t(state.titleKey)),
          h('p', null, t(hintKey)),
          h('p', null, t('repoHints.common')),
          h(
            'button',
            { type: 'button', className: 'gha-button', onClick: handleRefresh },
            t('refresh'),
          ),
        );
      };

      const renderSetup = () =>
        h(
          'div',
          { className: 'gha-state gha-setup' },
          h('h3', { className: 'gha-state-title' }, t('state.setup')),
          h('p', null, t('setup.intro')),
          h(
            'ol',
            { className: 'gha-steps' },
            h('li', null, t('setup.step1')),
            h('li', null, t('setup.step2')),
            h('li', null, t('setup.step3')),
          ),
          h(
            'dl',
            { className: 'gha-fields' },
            h('dt', null, t('setup.homepageLabel')),
            h('dd', null, t('setup.homepageValue')),
            h('dt', null, t('setup.callbackLabel')),
            h('dd', null, t('setup.callbackValue')),
            h('dt', null, t('setup.deviceFlowLabel')),
            h('dd', null, t('setup.deviceFlowValue')),
            h('dt', null, t('setup.tokenExpiryLabel')),
            h('dd', null, t('setup.tokenExpiryValue')),
          ),
          h(
            'form',
            { className: 'gha-form', onSubmit: handleSaveClientId },
            h(
              'label',
              { className: 'gha-field-label', htmlFor: 'gha-client-id' },
              t('setup.clientIdLabel'),
              h('input', {
                id: 'gha-client-id',
                className: 'gha-input',
                type: 'text',
                value: clientIdDraft,
                placeholder: t('setup.placeholder'),
                disabled: busy,
                onChange: (event) => {
                  const next =
                    event !== null &&
                    typeof event === 'object' &&
                    event.target !== undefined
                      ? event.target.value
                      : '';

                  setClientIdDraft(typeof next === 'string' ? next : '');
                },
              }),
            ),
            h(
              'button',
              { type: 'submit', className: 'gha-button', disabled: busy },
              busy ? t('setup.saving') : t('setup.save'),
            ),
          ),
        );

      const renderSignedOut = () =>
        h(
          'div',
          { className: 'gha-state gha-signed-out' },
          h('h3', { className: 'gha-state-title' }, t('state.signedOut')),
          h('p', null, t('signedOut.hint')),
          signIn === null
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'gha-button gha-button-primary',
                  onClick: handleBeginSignIn,
                },
                t('signIn'),
              )
            : h(
                'div',
                { className: 'gha-signin' },
                h('p', null, t('signIn.userCode')),
                h('code', { className: 'gha-user-code' }, signIn.userCode),
                h(
                  'a',
                  {
                    className: 'gha-link',
                    href: signIn.verificationUri,
                    target: '_blank',
                    rel: 'noreferrer noopener',
                  },
                  t('signIn.open'),
                ),
                h('p', { className: 'gha-pending' }, t('signIn.pending')),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'gha-button gha-button-quiet',
                    onClick: handleCancelSignIn,
                  },
                  t('signIn.cancel'),
                ),
              ),
        );

      const renderReady = () => {
        const history =
          viewSnapshot !== null && Array.isArray(viewSnapshot.history)
            ? viewSnapshot.history
            : [];
        const historyWarning =
          viewSnapshot !== null &&
          typeof viewSnapshot.historyWarning === 'string' &&
          viewSnapshot.historyWarning.length > 0
            ? viewSnapshot.historyWarning
            : null;

        const renderSection = (kind, rows, emptyLabel, warning) =>
          h(
            'section',
            { className: `gha-section gha-${kind}` },
            h(
              'div',
              {
                className: 'gha-scroll',
                tabIndex: 0,
                'aria-label': t(
                  kind === 'running' ? 'a11y.runningList' : 'a11y.recentList',
                ),
              },
              h(
                'h3',
                { className: 'gha-section-title' },
                t(kind === 'running' ? 'section.running' : 'section.recent'),
              ),
              warning === null
                ? null
                : h('p', { className: 'gha-history-warning', role: 'status' }, warning),
              renderHeader(kind === 'recent'),
              rows.length === 0
                ? h(
                    'div',
                    { className: 'gha-list gha-empty-wrap' },
                    h('p', { className: 'gha-empty-line' }, emptyLabel),
                  )
                : h('div', { role: 'list', className: 'gha-list' }, rows),
            ),
          );

        return h(
          'div',
          { className: 'gha-runs' },
          viewSnapshot.stale === true
            ? h('p', { className: 'gha-stale', role: 'status' }, t('stale.warning'))
            : null,
          renderSection('running', runs.map(renderRunRow), t('empty'), null),
          renderSection(
            'recent',
            history.map(renderHistoryRow),
            t('empty.history'),
            historyWarning,
          ),
        );
      };

      const renderBody = () => {
        if (state.kind === 'setup') return renderSetup();
        if (state.kind === 'signed-out') return renderSignedOut();
        if (state.kind === 'ready') return renderReady();
        if (
          state.kind === 'no-checkout' ||
          state.kind === 'no-remote' ||
          state.kind === 'not-github'
        ) {
          return renderRepoIssue();
        }

        return h(
          'div',
          { className: 'gha-state' },
          h('h3', { className: 'gha-state-title' }, t('state.error')),
          h('p', null, t('error.hint')),
          h(
            'button',
            { type: 'button', className: 'gha-button', onClick: handleRefresh },
            t('retry'),
          ),
        );
      };

      return h(
        'div',
        { className: 'gha-page' },
        toolbar,
        banner,
        h(
          'section',
          { className: 'gha-body' },
          loading
            ? h(
                'div',
                { className: 'gha-loading', role: 'status', 'aria-live': 'polite' },
                t('loading'),
              )
            : renderBody(),
        ),
      );
    }

    function activeAuthSnapshot(snapshot, auth) {
      if (auth === null || auth === undefined) return snapshot;

      return { ...snapshot, auth };
    }

    /* ------------------------------------------------------------------ */
    /* Registration                                                        */
    /* ------------------------------------------------------------------ */

    function apply(ctx, config) {
      const parsed = normalizeClientConfig(config);

      ctx.effect(() => ctx.locale.register(NS, dictionaries));

      const t = ctx.locale.bind(NS);
      const rpc = (method, payload) => ctx.connection.rpc.call('/api', method, payload);

      ctx.effect(() => {
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 30,
              locale: NS,
              label: () => t('panelTitle'),
            },
            GitHubActionsIcon,
          ),
        );

        ctx.slots.inject('main', () =>
          ctx.slots.register(
            {
              name: 'main',
              key: PANEL_ID,
              locale: NS,
              inject: () => ({ rpc, config: parsed }),
            },
            GitHubActionsPage,
          ),
        );
      });

      ctx.effect(installStyles);
    }

    return {
      inject,
      apply,
      describeState,
      nextPollDelay,
      visibleRuns,
      dictionaries,
      icon: GitHubActionsIcon,
    };
  },
});
