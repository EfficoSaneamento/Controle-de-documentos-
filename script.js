// ─── CONFIG ─────────────────────────────────────────────────────────────────
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzuOLM2GWyJtPz10OvbmpPsu0a1hQHUr-UiwjAYAumB6jpbmT_mZzMLlTUFINbRojrj/exec";
const STORAGE_KEY = "effico_admissao_progresso";

const PJ_CAMPOS = [
    { section: "Dados pessoais",         label: "Nome completo",         key: "nome",              type: "text"  },
    { section: "Dados pessoais",         label: "Data de nascimento",    key: "dataNascimento",    type: "text"  },
    { section: "Dados pessoais",         label: "RG",                    key: "rg",                type: "text"  },
    { section: "Dados pessoais",         label: "CPF",                   key: "cpf",               type: "text"  },
    { section: "Dados pessoais",         label: "Estado civil",          key: "estadoCivil",       type: "text"  },
    { section: "Dados pessoais",         label: "Nacionalidade",         key: "nacionalidade",     type: "text"  },
    { section: "Dados pessoais",         label: "Endereço completo",     key: "endereco",          type: "text"  },
    { section: "Dados da empresa",       label: "CNPJ",                  key: "cnpj",              type: "text"  },
    { section: "Dados da empresa",       label: "Razão social completa", key: "razaoSocial",       type: "text"  },
    { section: "Formação e contato",     label: "Formação acadêmica",    key: "formacaoAcademica", type: "text"  },
    { section: "Formação e contato",     label: "E-mail",                key: "email",             type: "email" },
    { section: "Formação e contato",     label: "Telefone + DDD",        key: "telefone",          type: "tel"   }
];

const ETAPAS = [
    { label: "Foto para crachá",               hint: "Centralize seu rosto dentro do círculo",      key: "01_Selfie",          isFace: true,  isShirt: false },
    { label: "CTPS",                            hint: "Página com foto e dados pessoais",             key: "02_CTPS",            isFace: false, isShirt: false },
    { label: "CPF",                             hint: "Documento original ou cópia",                  key: "03_CPF",             isFace: false, isShirt: false },
    { label: "RG",                              hint: "Frente e verso do documento",                  key: "04_RG",              isFace: false, isShirt: false },
    { label: "PIS",                             hint: "Cartão Cidadão ou extrato do FGTS",            key: "05_PIS",             isFace: false, isShirt: false },
    { label: "CNH",                             hint: "Cópia da CNH (se possuir)",                    key: "06_CNH",             isFace: false, isShirt: false },
    { label: "Reservista",                      hint: "Certificado militar (se aplicável)",            key: "07_Reservista",      isFace: false, isShirt: false },
    { label: "Comprovante de residência",       hint: "Conta recente de luz, água ou internet",       key: "08_Endereco",        isFace: false, isShirt: false },
    { label: "Vale Transporte",                 hint: "Cartão ou formulário preenchido",               key: "09_VT",              isFace: false, isShirt: false },
    { label: "Certidão Civil",                  hint: "Nascimento ou certidão de casamento",           key: "10_Certidao_Civil",  isFace: false, isShirt: false },
    { label: "CPF do cônjuge",                  hint: "Se aplicável",                                  key: "11_CPF_Conjuge",     isFace: false, isShirt: false },
    { label: "Documentos dos filhos",           hint: "RG ou certidão de nascimento (se aplicável)",  key: "12_Doc_Filhos",      isFace: false, isShirt: false },
    { label: "Carteira de vacinação dos filhos",hint: "Se aplicável",                                  key: "13_Vacina_Filhos",   isFace: false, isShirt: false },
    { label: "CPF dos filhos",                  hint: "Se aplicável",                                  key: "14_CPF_Filhos",      isFace: false, isShirt: false },
    { label: "Vacina – Saúde",                  hint: "Hepatite B e Tétano",                           key: "15_Vacina_Saude",    isFace: false, isShirt: false },
    { label: "Vacina – Covid-19",               hint: "Comprovante de vacinação",                      key: "16_Vacina_Covid",    isFace: false, isShirt: false },
    { label: "Conta Itaú",                      hint: "Cartão ou extrato bancário",                    key: "17_Conta_Itau",      isFace: false, isShirt: false },
    { label: "Comprovante de escolaridade",     hint: "Diploma ou declaração de conclusão",            key: "18_Escolaridade",    isFace: false, isShirt: false },
    { label: "Tamanho de camisa",               hint: "Selecione o tamanho para o uniforme",           key: "19_Tamanho",         isFace: false, isShirt: true  }
];

const SHIRT_SIZES = ["PP", "P", "M", "G", "GG", "XG", "XGG", "ESPECIAL"];

// ─── STATE ───────────────────────────────────────────────────────────────────
let currentIdx   = 0;
let fotos        = {};
let pendingImage = null;   // base64 aguardando confirmação
let stream       = null;
let selectedSize = null;

// ─── SALVAR / RETOMAR PROGRESSO ─────────────────────────────────────────────
function salvarProgresso() {
    const nome   = document.getElementById("nome").value.trim();
    const funcao = document.getElementById("funcao").value.trim();
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ nome, funcao, fotos, currentIdx }));
    } catch (e) {
        // localStorage cheio (fotos grandes) — segue sem salvar, não trava o fluxo
        console.warn("Não foi possível salvar o progresso:", e);
        showToast("Aviso: progresso pode não ser salvo automaticamente.", "error");
    }
}

function limparProgresso() {
    localStorage.removeItem(STORAGE_KEY);
}

function retomarProgresso(saved) {
    document.getElementById("nome").value   = saved.nome   || "";
    document.getElementById("funcao").value = saved.funcao || "";
    fotos      = saved.fotos      || {};
    currentIdx = saved.currentIdx || 0;
    hideAll();
    document.getElementById("progressWrapper").classList.remove("hidden");
    document.getElementById("cameraSection").classList.remove("hidden");
    carregarEtapa();
}

function verificarProgressoSalvo() {
    let saved;
    try {
        saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch (e) {
        saved = null;
    }
    if (!saved || !saved.currentIdx) return;

    const faltam = ETAPAS.length - saved.currentIdx;
    abrirModal(
        "Continuar de onde parou?",
        "Encontramos um envio em andamento para " + (saved.nome || "você") + " (" + saved.currentIdx + " de " + ETAPAS.length + " etapas concluídas). Deseja continuar apenas com o que falta (" + faltam + " etapas) ou começar do zero?",
        "Continuar",
        () => retomarProgresso(saved),
        () => limparProgresso(),
        "Começar do zero",
        "primary"
    );
}

// ─── TOAST ───────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = "") {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.className = "toast" + (type ? " toast-" + type : "");
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}

// ─── MODAL ───────────────────────────────────────────────────────────────────
let modalCallback       = null;
let modalCancelCallback = null;
function abrirModal(titulo, texto, labelConfirm, cb, onCancel, labelCancel, variant) {
    const confirmBtn = document.getElementById("modalConfirmBtn");
    document.getElementById("modalTitle").textContent = titulo;
    document.getElementById("modalText").textContent  = texto;
    confirmBtn.textContent = labelConfirm;
    confirmBtn.classList.remove("variant-danger", "variant-primary");
    if (variant) confirmBtn.classList.add("variant-" + variant);
    document.getElementById("modalCancelBtn").textContent  = labelCancel || "Cancelar";
    modalCallback       = cb;
    modalCancelCallback = onCancel || null;
    document.getElementById("modalBackdrop").classList.remove("hidden");
}
function fecharModal() { document.getElementById("modalBackdrop").classList.add("hidden"); }
document.getElementById("modalConfirmBtn").onclick = () => { fecharModal(); if (modalCallback) modalCallback(); };
document.getElementById("modalCancelBtn").onclick  = () => { fecharModal(); if (modalCancelCallback) modalCancelCallback(); };

// ─── NAVEGAÇÃO DE SEÇÕES ─────────────────────────────────────────────────────
function hideAll() {
    ["lgpdSection","tipoSection","pjSection","setupSection","cameraSection","previewSection",
     "shirtSection","summarySection","sendingSection","successSection"
    ].forEach(id => document.getElementById(id).classList.add("hidden"));
}

// ─── LGPD → TIPO DE CONTRATAÇÃO ──────────────────────────────────────────────
function irParaTipo() {
    hideAll();
    document.getElementById("tipoSection").classList.remove("hidden");
    document.getElementById("statusLabel").textContent      = "Tipo de contratação";
    document.getElementById("instructionLabel").textContent = "Você será contratado como CLT ou PJ?";
}

function selecionarTipo(tipo) {
    if (tipo === "PJ") {
        irParaFormularioPJ();
        return;
    }
    irParaCadastro();
}

// ─── TIPO → FORMULÁRIO PJ ────────────────────────────────────────────────────
function irParaFormularioPJ() {
    hideAll();
    const container = document.getElementById("pjFormFields");
    let ultimaSecao = null;
    container.innerHTML = PJ_CAMPOS.map(c => {
        const cabecalho = c.section !== ultimaSecao
            ? `<div class="form-section-title">${c.section}</div>`
            : "";
        ultimaSecao = c.section;
        return cabecalho + `
            <div class="input-group">
                <label for="pj_${c.key}">${c.label} *</label>
                <input type="${c.type}" id="pj_${c.key}" placeholder="Digite aqui">
            </div>
        `;
    }).join("");
    container.querySelectorAll("input").forEach(inp => {
        inp.addEventListener("input", () => inp.classList.remove("error"));
    });

    document.getElementById("pjSection").classList.remove("hidden");
    document.getElementById("statusLabel").textContent      = "Cadastro PJ";
    document.getElementById("instructionLabel").textContent = "Preencha seus dados abaixo";
}

function enviarPJ() {
    const dados = {};
    for (const c of PJ_CAMPOS) {
        const input = document.getElementById("pj_" + c.key);
        const val   = input.value.trim();
        if (!val) {
            showToast("Preencha \"" + c.label + "\".", "error");
            input.classList.add("error");
            return;
        }
        dados[c.key] = val;
    }

    const btn = document.getElementById("btnEnviarPJ");
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';

    fetch(SCRIPT_URL, { method: "POST", mode: "no-cors", body: JSON.stringify({ tipo: "PJ", dados }) })
        .then(() => {
            document.getElementById("successTitle").textContent = "Cadastro enviado!";
            document.getElementById("successText").textContent  = "Seus dados foram recebidos com sucesso pela EFFICO. O RH entrará em contato em breve.";
            hideAll();
            document.getElementById("successSection").classList.remove("hidden");
        })
        .catch(erro => {
            console.error(erro);
            showToast("Erro ao enviar cadastro.", "error");
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-paper-plane"></i> Enviar Cadastro';
        });
}

// ─── TIPO → CADASTRO ─────────────────────────────────────────────────────────
function irParaCadastro() {
    hideAll();
    document.getElementById("setupSection").classList.remove("hidden");
    document.getElementById("statusLabel").textContent      = "Seus dados";
    document.getElementById("instructionLabel").textContent = "Preencha as informações abaixo";
}

// ─── CADASTRO → CAPTURA ──────────────────────────────────────────────────────
function iniciarCaptura() {
    const nome   = document.getElementById("nome").value.trim();
    const funcao = document.getElementById("funcao").value.trim();
    if (!nome)   { showToast("Por favor, informe seu nome completo.", "error"); document.getElementById("nome").classList.add("error"); return; }
    if (!funcao) { showToast("Por favor, informe a função/cargo.", "error"); document.getElementById("funcao").classList.add("error"); return; }

    hideAll();
    document.getElementById("progressWrapper").classList.remove("hidden");
    document.getElementById("cameraSection").classList.remove("hidden");
    currentIdx = 0;
    carregarEtapa();
}

// ─── CARREGAR ETAPA ──────────────────────────────────────────────────────────
async function carregarEtapa() {
    if (currentIdx >= ETAPAS.length) { mostrarResumo(); return; }

    const etapa = ETAPAS[currentIdx];
    const pct   = Math.round((currentIdx / ETAPAS.length) * 100);

    document.getElementById("statusLabel").textContent      = etapa.label;
    document.getElementById("instructionLabel").textContent = etapa.hint;
    document.getElementById("progressFill").style.width     = pct + "%";
    document.getElementById("stepCount").textContent        = (currentIdx + 1) + " de " + ETAPAS.length;

    hideAll();
    document.getElementById("progressWrapper").classList.remove("hidden");

    // Etapa especial: tamanho de camisa
    if (etapa.isShirt) {
        selectedSize = null;
        renderShirtGrid();
        document.getElementById("shirtSection").classList.remove("hidden");
        document.getElementById("btnConfirmShirt").disabled = true;
        return;
    }

    // Etapa de câmera
    document.getElementById("cameraSection").classList.remove("hidden");
    document.getElementById("cameraHint").textContent = etapa.hint;

    const guide = document.getElementById("cameraGuide");
    guide.className = "camera-guide " + (etapa.isFace ? "guide-circle" : "guide-rect");

    document.getElementById("video").classList.toggle("mirror", etapa.isFace);
    mostrarErroCamera(false);

    if (stream) stream.getTracks().forEach(t => t.stop());
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: etapa.isFace ? "user" : "environment", width: { ideal: 1280 }, height: { ideal: 960 } }
        });
        document.getElementById("video").srcObject = stream;
    } catch (e) {
        showToast("Câmera não disponível. Use o botão de galeria.", "error");
        mostrarErroCamera(true);
    }
}

function mostrarErroCamera(mostrar) {
    document.getElementById("cameraError").classList.toggle("hidden", !mostrar);
    document.getElementById("cameraGuide").classList.toggle("hidden", mostrar);
    document.getElementById("cameraHint").classList.toggle("hidden", mostrar);
}

// ─── CAPTURA DE FOTO ─────────────────────────────────────────────────────────
function tirarFoto() {
    const video = document.getElementById("video");
    if (!video.videoWidth) { showToast("Aguarde a câmera carregar.", "error"); return; }

    const MAX = 1024;
    const ratio = MAX / Math.max(video.videoWidth, video.videoHeight);
    const w = Math.round(video.videoWidth  * ratio);
    const h = Math.round(video.videoHeight * ratio);

    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");

    if (ETAPAS[currentIdx].isFace) { ctx.translate(w, 0); ctx.scale(-1, 1); }
    ctx.drawImage(video, 0, 0, w, h);

    pendingImage = canvas.toDataURL("image/jpeg", 0.7);
    mostrarPreview(pendingImage);
}

function processarArquivo(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;

    // Validação de tipo
    const allowed = ["image/jpeg","image/png","image/webp","image/heic","application/pdf"];
    if (!allowed.includes(file.type)) {
        showToast("Formato inválido. Envie uma imagem ou PDF.", "error");
        return;
    }

    const reader = new FileReader();
    reader.onload = ev => {
        if (file.type === "application/pdf") {
            // PDF: armazena diretamente, sem preview visual
            pendingImage = ev.target.result;
            confirmarFoto();
        } else {
            // Redimensiona imagem
            const img = new Image();
            img.onload = () => {
                const MAX = 1024;
                const ratio = MAX / Math.max(img.width, img.height);
                const w = Math.round(img.width  * ratio);
                const h = Math.round(img.height * ratio);
                const c = document.createElement("canvas");
                c.width = w; c.height = h;
                c.getContext("2d").drawImage(img, 0, 0, w, h);
                pendingImage = c.toDataURL("image/jpeg", 0.7);
                mostrarPreview(pendingImage);
            };
            img.src = ev.target.result;
        }
    };
    reader.readAsDataURL(file);
}

// ─── PREVIEW ─────────────────────────────────────────────────────────────────
function mostrarPreview(src) {
    if (stream) stream.getTracks().forEach(t => t.stop());
    hideAll();
    document.getElementById("progressWrapper").classList.remove("hidden");
    document.getElementById("previewImg").src = src;
    document.getElementById("previewSection").classList.remove("hidden");
}

function voltarCamera() {
    pendingImage = null;
    carregarEtapa();
}

function confirmarFoto() {
    fotos[ETAPAS[currentIdx].key] = pendingImage;
    pendingImage = null;
    currentIdx++;
    salvarProgresso();
    carregarEtapa();
}

// ─── PULAR DOCUMENTO ─────────────────────────────────────────────────────────
function confirmarPular() {
    abrirModal(
        "Pular este documento?",
        "\"" + ETAPAS[currentIdx].label + "\" será marcado como não informado.",
        "Pular",
        () => { fotos[ETAPAS[currentIdx].key] = "NÃO POSSUI"; currentIdx++; salvarProgresso(); carregarEtapa(); }
    );
}

// ─── TAMANHO DE CAMISA ───────────────────────────────────────────────────────
function renderShirtGrid() {
    const grid = document.getElementById("shirtGrid");
    grid.innerHTML = SHIRT_SIZES.map(s =>
        `<button class="size-btn${selectedSize === s ? " selected" : ""}" onclick="selecionarTamanho('${s}')">${s}</button>`
    ).join("");
}

function selecionarTamanho(size) {
    selectedSize = size;
    renderShirtGrid();
    document.getElementById("btnConfirmShirt").disabled = false;
}

function confirmarTamanho() {
    if (!selectedSize) { showToast("Selecione um tamanho.", "error"); return; }
    fotos[ETAPAS[currentIdx].key] = "TAMANHO: " + selectedSize;
    currentIdx++;
    salvarProgresso();
    carregarEtapa();
}

// ─── RESUMO ──────────────────────────────────────────────────────────────────
function mostrarResumo() {
    if (stream) stream.getTracks().forEach(t => t.stop());
    hideAll();
    document.getElementById("progressWrapper").classList.remove("hidden");
    document.getElementById("summarySection").classList.remove("hidden");
    document.getElementById("progressFill").style.width = "100%";
    document.getElementById("stepCount").textContent     = "Concluído";
    document.getElementById("statusLabel").textContent      = "Revisão final";
    document.getElementById("instructionLabel").textContent = "Confira tudo antes de enviar";

    const list = document.getElementById("summaryList");
    list.innerHTML = ETAPAS.map((e, i) => {
        const val    = fotos[e.key];
        const ok     = val && val !== "NÃO POSSUI";
        const badge  = ok ? '<span class="badge badge-ok">OK</span>' : '<span class="badge badge-skip">Pulado</span>';
        return `<div class="summary-item">
            <span class="summary-item-name">${e.label}</span>
            ${badge}
            <button class="btn-edit" onclick="editarEtapa(${i})">Alterar</button>
        </div>`;
    }).join("");
}

function editarEtapa(idx) {
    currentIdx = idx;
    carregarEtapa();
}

// ─── REINICIAR ───────────────────────────────────────────────────────────────
function confirmarReinicio() {
    abrirModal(
        "Reiniciar processo?",
        "Todos os documentos capturados serão perdidos e você voltará ao início.",
        "Sim, reiniciar",
        () => { limparProgresso(); location.reload(); },
        null,
        null,
        "danger"
    );
}

// ─── PROGRESSO DE ENVIO (lista por documento) ───────────────────────────────
const UPLOAD_ICONS  = { pending: "fa-circle-notch", sending: "fa-spinner fa-spin", done: "fa-check-circle", fail: "fa-times-circle" };
const UPLOAD_LABELS = { pending: "Aguardando", sending: "Enviando", done: "Enviado", fail: "Falhou" };

function renderUploadProgressList(status) {
    const list = document.getElementById("uploadProgressList");
    list.innerHTML = ETAPAS.map(e => {
        const st = status[e.key] || "pending";
        return `<div class="upload-item">
            <span class="upload-item-icon status-${st}"><i class="fas ${UPLOAD_ICONS[st]}"></i></span>
            <span class="upload-item-name">${e.label}</span>
            <span class="upload-item-status status-${st}">${UPLOAD_LABELS[st]}</span>
        </div>`;
    }).join("");
}

// ─── ENVIO ───────────────────────────────────────────────────────────────────
async function enviarTudo() {
    const btn = document.getElementById("btnFinalizar");
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';

    const nome   = document.getElementById("nome").value.trim();
    const funcao = document.getElementById("funcao").value.trim();
    const payload = { dados: { nome, funcao }, fotos };

    const status = {};
    ETAPAS.forEach(e => status[e.key] = "sending");

    hideAll();
    document.getElementById("progressWrapper").classList.remove("hidden");
    document.getElementById("sendingSection").classList.remove("hidden");
    document.getElementById("progressFill").style.width = "50%";
    renderUploadProgressList(status);

    try {
        await fetch(SCRIPT_URL, { method: "POST", mode: "no-cors", body: JSON.stringify(payload) });

        ETAPAS.forEach(e => status[e.key] = "done");
        renderUploadProgressList(status);
        document.getElementById("progressFill").style.width = "100%";

        limparProgresso();
        hideAll();
        document.getElementById("successSection").classList.remove("hidden");
    } catch (erro) {
        console.error(erro);

        ETAPAS.forEach(e => status[e.key] = "fail");
        renderUploadProgressList(status);
        showToast("Erro ao enviar documentos.", "error");

        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-paper-plane"></i> Finalizar e enviar';

        hideAll();
        document.getElementById("summarySection").classList.remove("hidden");
    }
}

// ─── AVISO AO SAIR DA PÁGINA ─────────────────────────────────────────────────
window.addEventListener("beforeunload", (e) => {
    const emAndamento = currentIdx > 0 && currentIdx < ETAPAS.length
        && document.getElementById("successSection").classList.contains("hidden");
    if (emAndamento) {
        e.preventDefault();
        e.returnValue = "Tem certeza que deseja sair? O progresso será perdido.";
    }
});

// ─── LIMPAR CLASSE DE ERRO AO DIGITAR ────────────────────────────────────────
["nome","funcao"].forEach(id => {
    document.getElementById(id)?.addEventListener("input", () => {
        document.getElementById(id).classList.remove("error");
    });
});

// ─── AO CARREGAR A PÁGINA: verifica se há progresso salvo para retomar ──────
verificarProgressoSalvo();
