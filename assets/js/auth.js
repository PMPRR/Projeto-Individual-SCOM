/* ==========================================================================
   auth.js — melhorias progressivas das paginas de login e cadastro.
   Sem este arquivo os formularios continuam funcionando: a validacao e a
   nativa do HTML5 e o botao "Mostrar" permanece oculto.
   ========================================================================== */

(function () {
    "use strict";

    /* --- Mostrar / ocultar senha --- */
    document.querySelectorAll("[data-toggle-senha]").forEach(function (botao) {
        var campo = document.getElementById(botao.dataset.toggleSenha);
        if (!campo) {
            return;
        }

        botao.hidden = false;

        botao.addEventListener("click", function () {
            var visivel = campo.type === "text";
            campo.type = visivel ? "password" : "text";
            botao.textContent = visivel ? "Mostrar" : "Ocultar";
            campo.focus();
        });
    });

    /* --- Confirmacao de senha ---
       setCustomValidity marca o campo como invalido, entao :user-invalid e a
       mensagem do navegador funcionam igual aos outros erros do formulario. */
    var confirma = document.querySelector("[data-confirma-senha]");

    if (confirma) {
        var original = document.getElementById(confirma.dataset.confirmaSenha);

        if (original) {
            var verificar = function () {
                var iguais = confirma.value === original.value;
                confirma.setCustomValidity(iguais ? "" : "As senhas não são iguais.");
            };

            confirma.addEventListener("input", verificar);
            original.addEventListener("input", verificar);
        }
    }
})();
