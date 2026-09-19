/* ==========================================================================
   Menus expansiveis do cabecalho
   --------------------------------------------------------------------------
   Padrao menu-button (WAI-ARIA): o botao e a fonte de verdade do estado via
   aria-expanded, e o painel e removido da arvore de acessibilidade quando
   fechado. Abrir um menu fecha o outro.
   ========================================================================== */

(function () {
  "use strict";

  /* Seletores que delimitam a area "dentro" dos menus. Um clique ou foco
     fora deles fecha tudo. */
  const SELETOR_INTERNO = ".site-account, .site-nav";

  /* O filtro permite que este arquivo seja compartilhado por paginas que
     nao possuem todos os elementos, sem lancar erro. */
  const toggles = [
    {
      btn: document.querySelector(".site-nav-toggle"),
      panel: document.getElementById("nav-links"),
    },
    {
      btn: document.querySelector(".site-account-toggle"),
      panel: document.getElementById("account-menu"),
    },
  ].filter((t) => t.btn && t.panel);

  if (toggles.length === 0) return;

  function setOpen(entry, open) {
    entry.btn.setAttribute("aria-expanded", String(open));
    entry.panel.classList.toggle("is-open", open);
    /* hidden garante que links fechados saiam da ordem de tabulacao,
       independentemente do CSS aplicado. */
    entry.panel.hidden = !open;
  }

  function isOpen(entry) {
    return entry.btn.getAttribute("aria-expanded") === "true";
  }

  function closeAll(except) {
    toggles.forEach(function (t) {
      if (t !== except) setOpen(t, false);
    });
  }

  toggles.forEach(function (entry) {
    setOpen(entry, false); /* estado inicial explicito */

    entry.btn.addEventListener("click", function () {
      const abrir = !isOpen(entry);
      closeAll(entry);
      setOpen(entry, abrir);
    });

    /* Setas navegam entre os itens do painel aberto. */
    entry.btn.addEventListener("keydown", function (evento) {
      if (evento.key !== "ArrowDown") return;
      evento.preventDefault();
      closeAll(entry);
      setOpen(entry, true);
      entry.panel.querySelector("a").focus();
    });

    entry.panel.addEventListener("keydown", function (evento) {
      const itens = entry.panel.querySelectorAll("a");
      const atual = Array.prototype.indexOf.call(itens, document.activeElement);

      if (evento.key === "ArrowDown") {
        evento.preventDefault();
        itens[(atual + 1) % itens.length].focus();
      } else if (evento.key === "ArrowUp") {
        evento.preventDefault();
        itens[(atual - 1 + itens.length) % itens.length].focus();
      }
    });
  });

  /* Clique fora fecha. Testar o alvo evita stopPropagation nos botoes,
     que impediria outros listeners de document de receberem o evento. */
  document.addEventListener("click", function (evento) {
    if (!evento.target.closest(SELETOR_INTERNO)) closeAll();
  });

  /* Sair dos menus com Tab tambem fecha. */
  document.addEventListener("focusin", function (evento) {
    if (!evento.target.closest(SELETOR_INTERNO)) closeAll();
  });

  document.addEventListener("keydown", function (evento) {
    if (evento.key !== "Escape") return;
    const aberto = toggles.find(isOpen);
    if (aberto) {
      setOpen(aberto, false);
      aberto.btn.focus(); /* devolve o foco ao gatilho */
    }
  });
})();
