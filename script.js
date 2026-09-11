(function () {
  'use strict';

  var FORM_ID = 'LpIsqPCW';
  var FORM_URL = 'https://form.typeform.com/to/' + FORM_ID;

  var CONFIG = {
    // Pop-up quando o mouse sai pelo topo da janela (desktop).
    exitIntent: true,
    // Intercepta o botão "voltar" do celular (mobile não tem exit intent).
    backButtonGuard: true,
    // Diálogo nativo do navegador ao fechar a aba. Ver limitações no README.
    beforeUnload: true,
    // Se a pessoa não interagir com o form, arma o pop-up assim mesmo
    // depois desse tempo (ms). Use 0 para só armar após começar a responder.
    armAfterMs: 12000,
    // Mostra o pop-up no máximo uma vez por sessão.
    oncePerSession: true
  };

  var STORAGE_KEY = 'tf_exit_shown_' + FORM_ID;

  var container = document.getElementById('typeform');
  var modal = document.getElementById('exitModal');

  /* ------------------------------------------------------------ tracking */

  /**
   * Todo evento vai para a dataLayer do GTM (GTM-T9Z94N6), e só para ela. É o
   * contêiner que decide qual pixel ou GA4 recebe o quê — mesmo contrato das
   * captações do DevClub e do MBA: `generate_lead` só depois do envio
   * confirmado pelo Typeform, com `event_id` próprio, e os UTMs da URL em
   * todo evento.
   *
   * Nada de fbq() ou gtag() direto daqui. Com o GTM na página, window.fbq
   * passa a existir, e um fbq('track','Lead') solto mandaria Lead para TODO
   * pixel que o contêiner inicializou, em dobro com a tag de Lead.
   */
  function utmsDaUrl() {
    var chaves = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid'];
    var params = new URLSearchParams(window.location.search);
    var utm = {};
    chaves.forEach(function (k) {
      var v = params.get(k);
      if (v) utm[k] = v;
    });
    return utm;
  }

  function track(evento, props) {
    var base = {
      event: evento,
      event_id: evento + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9),
      channel_slug: 'mba-typeform',
      page_version: 'v1',
      form_id: FORM_ID
    };
    var utm = utmsDaUrl();
    Object.keys(utm).forEach(function (k) { base[k] = utm[k]; });
    Object.keys(props || {}).forEach(function (k) {
      if (props[k] !== undefined && props[k] !== null) base[k] = props[k];
    });
    try {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push(base);
    } catch (e) { /* tracking nunca derruba o formulário */ }
  }

  var state = {
    started: false,    // já respondeu alguma pergunta
    submitted: false,  // já enviou
    armed: false,      // pop-up habilitado
    open: false,       // pop-up visível agora
    shown: false       // já foi mostrado nesta sessão
  };

  /* ---------------------------------------------------------------- form */

  /**
   * Repassa os UTMs / query params da página atual para o formulário como
   * hidden fields. Só funciona para campos declarados como "hidden" no Typeform.
   */
  function collectHiddenFields() {
    var allowed = [
      'utm_source', 'utm_medium', 'utm_campaign',
      'utm_term', 'utm_content', 'email', 'name'
    ];
    var params = new URLSearchParams(window.location.search);
    var hidden = {};

    allowed.forEach(function (key) {
      var value = params.get(key);
      if (value) hidden[key] = value;
    });

    return hidden;
  }

  function renderFallback() {
    container.innerHTML =
      '<iframe class="form-embed__fallback" src="' + FORM_URL + '" ' +
      'title="Formulário de inscrição" ' +
      'allow="camera; microphone; autoplay; encrypted-media;"></iframe>';
  }

  function mountForm() {
    // SDK não carregou (adblock, offline, CSP) → usa iframe direto.
    if (!window.tf || typeof window.tf.createWidget !== 'function') {
      renderFallback();
      return;
    }

    window.tf.createWidget(FORM_ID, {
      container: container,
      hidden: collectHiddenFields(),
      // opacity: 0 deixa o fundo do form transparente (herda o dark da página).
      // Só use se o tema do form no painel do Typeform tiver texto claro,
      // senão o texto some no fundo escuro.
      opacity: 100,
      inlineOnMobile: true,
      // autoResize desligado de propósito: a altura é controlada pelo CSS,
      // que faz o embed ter tamanho fixo e não "pular" ao carregar.
      autoResize: false,

      // O formulário carregou e está na tela.
      onReady: function () {
        track('view_form');
      },

      onStarted: function () {
        if (!state.started) track('form_start');
        state.started = true;
        arm();
      },

      onQuestionChanged: function () {
        state.started = true;
        arm();
      },

      onSubmit: function (event) {
        state.submitted = true;
        disarm();

        // Só aqui a pessoa virou lead: o Typeform confirmou o envio.
        // event.responseId é o id da resposta, para casar com o painel.
        track('generate_lead', { response_id: event && event.responseId });
      }
    });
  }

  /* ------------------------------------------------------------- pop-up */

  function alreadyShown() {
    if (!CONFIG.oncePerSession) return false;
    try {
      return sessionStorage.getItem(STORAGE_KEY) === '1';
    } catch (e) {
      return false; // modo privado / storage bloqueado
    }
  }

  function markShown() {
    try {
      sessionStorage.setItem(STORAGE_KEY, '1');
    } catch (e) { /* ignora */ }
  }

  function arm() {
    if (state.armed || state.submitted || alreadyShown()) return;
    state.armed = true;

    if (CONFIG.backButtonGuard) {
      // Empilha um estado para que o "voltar" caia aqui em vez de sair.
      history.pushState({ tfGuard: true }, '');
    }
  }

  function disarm() {
    state.armed = false;
  }

  function openModal() {
    if (!state.armed || state.open || state.submitted || alreadyShown()) return;

    state.open = true;
    state.shown = true;
    markShown();

    modal.hidden = false;
    document.body.style.overflow = 'hidden';

    var primary = modal.querySelector('[data-continue]');
    if (primary) primary.focus();

    track('exit_intent_shown');
  }

  function closeModal(resume) {
    if (!state.open) return;

    state.open = false;
    modal.hidden = true;
    document.body.style.overflow = '';

    // Depois de mostrado uma vez, para de bloquear a saída.
    disarm();

    if (resume) {
      var iframe = container.querySelector('iframe');
      if (iframe) iframe.focus();
    }
  }

  function bindModal() {
    if (!modal) return;

    modal.addEventListener('click', function (event) {
      if (event.target.closest('[data-continue]')) {
        closeModal(true);
      } else if (event.target.closest('[data-close]')) {
        closeModal(false);
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeModal(false);
    });
  }

  /* ---------------------------------------------------------- gatilhos */

  function bindTriggers() {
    // 1. Exit intent: mouse cruzando o topo da janela (só desktop).
    if (CONFIG.exitIntent) {
      document.addEventListener('mouseout', function (event) {
        if (event.clientY > 0) return;          // não saiu por cima
        if (event.relatedTarget) return;        // ainda dentro da página
        openModal();
      });
    }

    // 2. Botão "voltar" — principal gatilho no celular.
    if (CONFIG.backButtonGuard) {
      window.addEventListener('popstate', function () {
        if (!state.armed || state.open) return;
        // Reempilha para segurar a pessoa e mostra o pop-up.
        history.pushState({ tfGuard: true }, '');
        openModal();
      });
    }

    // 3. Diálogo nativo ao fechar a aba / recarregar.
    //    O navegador ignora a mensagem customizada e só mostra o alerta se
    //    houver interação com a PÁGINA (clique no iframe do Typeform não conta).
    if (CONFIG.beforeUnload) {
      window.addEventListener('beforeunload', function (event) {
        if (!state.started || state.submitted) return;
        event.preventDefault();
        event.returnValue = '';
        return '';
      });
    }
  }

  /* -------------------------------------------------------------- init */

  function init() {
    if (!container) return;

    mountForm();
    bindModal();
    bindTriggers();

    if (CONFIG.armAfterMs > 0) {
      setTimeout(arm, CONFIG.armAfterMs);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
