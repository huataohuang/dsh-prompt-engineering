/**
 * 提示词工程 · 客户端半（Web Client）
 *
 * 一个 28px 的图标按钮，挂在发送区（conversation.input.right）——与旁边的「+」「权限」
 * 同一套控件尺寸，不描边、不占宽，悬停才显底色。点一下即就地优化：
 *   读取输入框草稿 → 交给宿主模型改写 → 直接替换回输入框（Enter 之前你仍可手改，Cmd+Z 可撤销）。
 * 不做预览面板：用户的诉求是「一点就优化」，多一步确认反而碍事。
 *
 * 空输入时整个图标不渲染（与 WorkBuddy 同款：没有输入就没有这个图标，一开始打字它才出现）。
 * 安全性由三条判断保证：草稿为空不发请求；输入框发送/执行中不写回；
 * 请求期间草稿被改动则不覆盖（只把状态显示成提醒，草稿原样保留）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-prompt-engineering',
  factory(require) {
    var React = require('react');
    var h = React.createElement;

    /** app 归属路由的文档相对形式（绝对路径去掉开头斜杠）。 */
    var ROUTE = 'api/prompt-engineering/optimize';
    var STYLE_ID = 'dsh-prompt-engineering-style';

    var LANG = (typeof navigator !== 'undefined' && navigator.language || 'zh').toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en';

    var TEXT = {
      zh: {
        label: '优化提示词',
        idle: '优化提示词：把输入框里的草稿改写成更专业的写法',
        running: '正在优化…',
        done: '已替换输入框内容，可继续修改或按 ⌘Z 撤销',
        empty: '输入框是空的，先写下你的需求',
        frozen: '输入框正在发送或执行中，等这一轮结束再试',
        changed: '优化期间草稿被改过，已放弃覆盖以免丢失你的修改',
        emptyOutput: '模型没有返回内容，请重试',
        failed: '优化失败：'
      },
      en: {
        label: 'Optimize prompt',
        idle: 'Optimize prompt: rewrite the draft into a professional prompt',
        running: 'Optimizing…',
        done: 'Draft replaced — keep editing or press Ctrl+Z to undo',
        empty: 'Nothing to optimize yet — write your request first',
        frozen: 'The composer is sending; try again after this turn',
        changed: 'The draft changed while optimizing, so it was left untouched',
        emptyOutput: 'The model returned nothing, please retry',
        failed: 'Optimization failed: '
      }
    };
    var T = TEXT[LANG] || TEXT.zh;

    /** 只有 hover / 状态色 / 旋转动画需要样式表；其余走 DSH 主题变量。 */
    var STYLE = [
      '[data-dsh-pe]{appearance:none;display:inline-flex;align-items:center;justify-content:center;flex:none;',
      'width:28px;height:28px;padding:0;border:0;border-radius:var(--dsw-radius-md,8px);background:transparent;',
      'color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background .12s ease,color .12s ease}',
      '[data-dsh-pe] svg{display:block}',
      '@media (hover:hover){[data-dsh-pe]:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}}',
      '[data-dsh-pe]:active{background:var(--dsw-alias-interactive-bg-active)}',
      '[data-dsh-pe]:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '[data-dsh-pe][data-empty="true"]{color:var(--dsh-pe-dim,var(--dsw-alias-label-tertiary));cursor:default}',
      '[data-dsh-pe][data-tone="busy"]{color:var(--dsw-alias-label-tertiary);cursor:progress}',
      '[data-dsh-pe][data-tone="done"]{color:var(--dsw-alias-state-success-primary)}',
      '[data-dsh-pe][data-tone="warn"]{color:var(--dsw-alias-state-warning-primary)}',
      '[data-dsh-pe][data-tone="error"]{color:var(--dsw-alias-state-error-primary)}',
      '@keyframes dsh-pe-spin{to{transform:rotate(360deg)}}',
      '.dsh-pe-spin{animation:dsh-pe-spin .9s linear infinite;transform-origin:50% 50%}',
      '@media (prefers-reduced-motion:reduce){.dsh-pe-spin{animation:none}}'
    ].join('');

    /** 每个会话一份按钮状态：按钮组件自身即订阅者，多 composer 互不串台。 */
    var entries = Object.create(null);

    function entryFor(sessionId) {
      var key = String(sessionId);
      if (entries[key]) return entries[key];
      var state = { busy: false, tone: 'idle', hint: '', latestDraft: '', latestPhase: 'plain' };
      var listeners = new Set();
      var timer = null;
      var entry = {
        getState: function () { return state; },
        subscribe: function (listener) {
          listeners.add(listener);
          return function () { listeners.delete(listener); };
        },
        set: function (patch) {
          state = Object.assign({}, state, patch);
          listeners.forEach(function (listener) { listener(); });
        },
        /** 短暂显示 done / warn / error，随后自动回到 idle。 */
        flash: function (tone, hint, ms) {
          if (timer !== null) clearTimeout(timer);
          entry.set({ busy: false, tone: tone, hint: hint });
          timer = setTimeout(function () {
            timer = null;
            entry.set({ tone: 'idle', hint: '' });
          }, ms);
        },
        dispose: function () {
          if (timer !== null) clearTimeout(timer);
          timer = null;
          listeners.clear();
          delete entries[key];
        }
      };
      entries[key] = entry;
      return entry;
    }

    function useEntry(sessionId) {
      var entry = entryFor(sessionId);
      var counter = React.useState(0);
      var bump = counter[1];
      React.useEffect(function () {
        return entry.subscribe(function () { bump(function (n) { return n + 1; }); });
      }, [sessionId]);
      return entry.getState();
    }

    /** 向宿主半请求一次改写；失败统一抛出带 message 的 Error。 */
    function requestRewrite(payload) {
      var url = new URL(ROUTE, document.baseURI).href;
      return fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function (response) {
        return response.json().catch(function () { return null; }).then(function (data) {
          if (data && data.ok === true) return data.value;
          var message = data && data.error && data.error.message
            ? data.error.message
            : 'HTTP ' + response.status;
          var error = new Error(message);
          error.code = data && data.error && data.error.code ? data.error.code : 'prompt-engineering/transport';
          throw error;
        });
      });
    }

    /** 一次性把样式表挂到 head；卸载时移除。 */
    function installStyle() {
      if (typeof document === 'undefined' || document.getElementById(STYLE_ID) !== null) {
        return function () {};
      }
      var element = document.createElement('style');
      element.id = STYLE_ID;
      element.textContent = STYLE;
      document.head.appendChild(element);
      return function () {
        if (element.parentNode) element.parentNode.removeChild(element);
      };
    }

    function Icon(props) {
      var common = {
        width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.35, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true'
      };
      if (props.tone === 'busy') {
        return h('svg', common, h('path', { d: 'M8 2.4a5.6 5.6 0 1 1-5.6 5.6', className: 'dsh-pe-spin' }));
      }
      if (props.tone === 'done') {
        return h('svg', common, h('path', { d: 'M3.2 8.6l3.1 3.1 6.5-7.4' }));
      }
      if (props.tone === 'warn' || props.tone === 'error') {
        return h('svg', common, h('path', { d: 'M8 2.6a5.4 5.4 0 1 0 0 10.8A5.4 5.4 0 0 0 8 2.6z' }), h('path', { d: 'M8 5.4v3.2' }), h('path', { d: 'M8 11.1h.01' }));
      }
      // 双星芒（仿 WorkBuddy 的优化入口）：细描边、无填充块，和其它图标控件同重
      return h('svg', common,
        h('path', { d: 'M9.5 2.3c.5 2.7 1.5 3.7 4.2 4.2-2.7.5-3.7 1.5-4.2 4.2-.5-2.7-1.5-3.7-4.2-4.2 2.7-.5 3.7-1.5 4.2-4.2z' }),
        h('path', { d: 'M4.2 9.6c.32 1.7.95 2.33 2.65 2.65-1.7.32-2.33.95-2.65 2.65-.32-1.7-.95-2.33-2.65-2.65 1.7-.32 2.33-.95 2.65-2.65z' })
      );
    }

    function OptimizeButton(props) {
      var sessionId = props.sessionId;
      var inputActions = props.inputActions;
      var draft = props.useInput(function (s) { return s.draft; });
      var phase = props.useInput(function (s) { return s.phase; });
      var entry = entryFor(sessionId);
      var state = useEntry(sessionId);

      // 异步回调必须读「最新」草稿与阶段，渲染期的快照只用于判断按钮外观。
      entry.latestDraft = draft;
      entry.latestPhase = phase;

      if (sessionId === undefined || sessionId === null) return null;

      var hasDraft = typeof draft === 'string' && draft.trim().length > 0;

      // 与 WorkBuddy 同款：空草稿不渲染图标，输入后自动出现。
      // 优化中即使草稿被清空也保留按钮，否则转圈状态会突然消失。
      if (!hasDraft && !state.busy) return null;
      var tone = state.busy ? 'busy' : state.tone;
      var title = state.hint !== ''
        ? state.hint
        : (hasDraft ? T.idle : T.empty);

      var onClick = function () {
        var current = entry.getState();
        if (current.busy) return;
        var text = typeof entry.latestDraft === 'string' ? entry.latestDraft.trim() : '';
        if (text.length === 0) { entry.flash('warn', T.empty, 2400); return; }
        if (entry.latestPhase !== 'plain') { entry.flash('warn', T.frozen, 2600); return; }
        entry.set({ busy: true, tone: 'busy', hint: T.running });
        requestRewrite({
          text: text,
          mode: 'auto',
          locale: LANG,
          sessionId: sessionId
        }).then(function (value) {
          var result = value && typeof value.text === 'string' ? value.text : '';
          if (result.trim().length === 0) { entry.flash('error', T.emptyOutput, 3200); return; }
          if (entry.latestPhase !== 'plain') { entry.flash('warn', T.frozen, 3000); return; }
          if (typeof entry.latestDraft === 'string' && entry.latestDraft.trim() !== text) {
            entry.flash('warn', T.changed, 3600);
            return;
          }
          inputActions.setDraft(result);
          entry.flash('done', T.done, 1800);
        }, function (error) {
          entry.flash('error', T.failed + ((error && error.message) || String(error)), 4000);
        });
      };

      return h('button', {
        type: 'button',
        'data-dsh-pe': 'trigger',
        'data-tone': tone,
        'data-empty': hasDraft ? 'false' : 'true',
        'aria-label': T.label,
        'aria-busy': state.busy ? 'true' : 'false',
        title: title,
        onMouseDown: function (event) { event.preventDefault(); },
        onClick: onClick
      }, h(Icon, { tone: tone }));
    }

    return {
      inject: ['slots'],
      apply: function (ctx) {
        var removeStyle = installStyle();
        ctx.effect(function () {
          return function () {
            removeStyle();
            Object.keys(entries).forEach(function (key) { entries[key].dispose(); });
          };
        }, 'prompt-engineering: styles and state');
        ctx.slots.inject('conversation.input.right', function () {
          return ctx.slots.register({
            name: 'conversation.input.right',
            id: 'prompt-engineering',
            order: 60
          }, OptimizeButton);
        });
      }
    };
  }
});
