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

      onStarted: function () {
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

        // event.responseId → id da resposta, útil para tracking.
        if (typeof window.gtag === 'function') {
          window.gtag('event', 'form_submit', {
            form_id: FORM_ID,
            response_id: event && event.responseId
          });
        }
        if (typeof window.fbq === 'function') {
          window.fbq('track', 'Lead');
        }
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

    if (typeof window.gtag === 'function') {
      window.gtag('event', 'exit_intent_shown', { form_id: FORM_ID });
    }
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
