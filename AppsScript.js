const PJ_LABELS = {
  nome: "Nome completo",
  endereco: "Endereço completo",
  dataNascimento: "Data de nascimento",
  rg: "RG",
  cpf: "CPF",
  estadoCivil: "Estado civil",
  nacionalidade: "Nacionalidade",
  cnpj: "CNPJ",
  razaoSocial: "Razão social completa",
  formacaoAcademica: "Formação acadêmica",
  email: "E-mail",
  telefone: "Telefone + DDD"
};

const PJ_ORDEM = [
  "nome", "endereco", "dataNascimento", "rg", "cpf", "estadoCivil",
  "nacionalidade", "cnpj", "razaoSocial", "formacaoAcademica", "email", "telefone"
];

const LOG_SHEET_NAME = "Log de Envios";
const RATE_LIMIT_JANELA_SEGUNDOS = 60;
const RATE_LIMIT_MAX_ENVIOS = 10;
const MAX_PAYLOAD_BYTES = 25 * 1024 * 1024;
const LOG_RETENTION_DAYS = 180;
const DOCUMENTS_FOLDER_PROPERTY = "DOCUMENTS_FOLDER_ID";
const PJ_REQUIRED_DOCUMENTS = [
  "PJ_Cartao_CNPJ", "PJ_CNH", "PJ_Certificado_Escolar",
  "PJ_Comprovante_Residencia", "PJ_Dados_Bancarios", "PJ_CND", "PJ_Foto_3x4"
];
const ALLOWED_FILE_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"];

function doPost(e) {

  let tipo = "desconhecido";
  let nome = "Não informado";
  let cpf = "Não informado";
  let email = "Não informado";
  let status = "erro";
  let mensagem = "";

  try {

    Logger.log("CHEGOU NO SCRIPT");

    if (!verificarLimiteDeEnvio()) {
      throw new Error("Muitos envios em pouco tempo. Tente novamente em instantes.");
    }

    if (!e || !e.postData || !e.postData.contents) {
      throw new Error("Nenhum dado recebido.");
    }

    // Não logamos e.postData.contents nem o JSON completo: podem conter
    // fotos em base64 e dados pessoais, e ficariam expostos no log de execução.
    if (e.postData.contents.length > MAX_PAYLOAD_BYTES) {
      throw new Error("Envio excede o tamanho permitido.");
    }

    Logger.log("Payload recebido: " + e.postData.contents.length + " caracteres");

    const data = JSON.parse(e.postData.contents);

    if (!data.dados) {
      throw new Error("Dados do candidato não encontrados.");
    }

    if (data.tipo !== "PJ" && data.tipo !== "CLT") {
      throw new Error("Tipo de cadastro inválido.");
    }
    tipo = data.tipo;
    nome = data.dados.nome || "Não informado";
    cpf = data.dados.cpf || "Não informado";
    email = data.dados.email || "Não informado";
    validarDados(data);

    if (tipo === "PJ") {
      enviarEmailPJ(data.dados, data.fotos);
    } else {
      enviarEmailCLT(data.dados, data.fotos);
    }

    status = "sucesso";

    return ContentService
      .createTextOutput(
        JSON.stringify({
          status: "success",
          message: "Dados enviados com sucesso."
        })
      )
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {

    Logger.log(error);
    Logger.log(error.stack || error.toString());
    mensagem = "Falha ao processar o envio.";

    return ContentService
      .createTextOutput(
        JSON.stringify({
          status: "error",
          message: mensagem
        })
      )
      .setMimeType(ContentService.MimeType.JSON);

  } finally {

    registrarLog(tipo, nome, cpf, email, status, mensagem);
  }
}

// ─── LIMITE DE TAXA (proteção básica contra flood no endpoint público) ──────
// Limitação: o Apps Script não expõe o IP de quem chamou doPost, então o
// limite é global (não por pessoa) — reduz risco de flood automatizado.
function verificarLimiteDeEnvio() {

  const cache = CacheService.getScriptCache();
  const chave = "envios_recentes";
  const atual = Number(cache.get(chave) || 0);

  if (atual >= RATE_LIMIT_MAX_ENVIOS) {
    return false;
  }

  cache.put(chave, String(atual + 1), RATE_LIMIT_JANELA_SEGUNDOS);
  return true;
}

function validarDados(data) {
  const dados = data.dados;
  ["nome", "cpf", "email"].forEach(function (campo) {
    if (typeof dados[campo] !== "string" || !dados[campo].trim()) {
      throw new Error("Campo obrigatório ausente.");
    }
  });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dados.email.trim())) {
    throw new Error("E-mail inválido.");
  }
  if (data.tipo === "CLT" && (!dados.funcao || !String(dados.funcao).trim())) {
    throw new Error("Campo obrigatório ausente.");
  }
  if (data.tipo === "PJ") {
    PJ_ORDEM.forEach(function (campo) {
      if (typeof dados[campo] !== "string" || !dados[campo].trim()) {
        throw new Error("Campo obrigatório ausente.");
      }
    });
    PJ_REQUIRED_DOCUMENTS.forEach(function (key) {
      if (!data.fotos || !data.fotos[key]) throw new Error("Documento obrigatório ausente.");
    });
  }
  validarFotos(data.fotos || {});
}

function validarFotos(fotos) {
  Object.keys(fotos).forEach(function (key) {
    const valor = fotos[key];
    if (valor === "NÃO POSSUI" || valor === "NAO POSSUI" || String(valor).startsWith("TAMANHO:")) return;
    if (typeof valor !== "string" || valor.length > 8 * 1024 * 1024 || !/^data:[^;,]+;base64,/.test(valor)) {
      throw new Error("Arquivo inválido.");
    }
    const tipo = valor.match(/^data:([^;,]+);base64,/)[1];
    if (!ALLOWED_FILE_TYPES.includes(tipo)) throw new Error("Tipo de arquivo não permitido.");
  });
}

function escaparHtml(valor) {
  return String(valor == null ? "" : valor).replace(/[&<>"']/g, function (caractere) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[caractere];
  });
}

function mascararCpf(cpf) {
  const digitos = String(cpf || "").replace(/\D/g, "");
  return digitos.length >= 4 ? "***.***." + digitos.slice(-3, -1) + "-" + digitos.slice(-1) : "Não informado";
}

function obterPastaDocumentos() {
  const props = PropertiesService.getScriptProperties();
  const idSalvo = props.getProperty(DOCUMENTS_FOLDER_PROPERTY);
  if (idSalvo) {
    try { return DriveApp.getFolderById(idSalvo); } catch (erro) { Logger.log(erro); }
  }
  const pasta = DriveApp.createFolder("EFFICO - Documentos de Admissão");
  props.setProperty(DOCUMENTS_FOLDER_PROPERTY, pasta.getId());
  return pasta;
}

function limparLogsAntigos(aba) {
  const limite = new Date(Date.now() - LOG_RETENTION_DAYS * 86400000);
  const ultimaLinha = aba.getLastRow();
  if (ultimaLinha <= 1) return;
  const datas = aba.getRange(2, 1, ultimaLinha - 1, 1).getValues();
  for (let indice = datas.length - 1; indice >= 0; indice--) {
    if (datas[indice][0] instanceof Date && datas[indice][0] < limite) aba.deleteRow(indice + 2);
  }
}

function criarArquivoNoDrive(chave, conteudo) {
  const partes = conteudo.match(/^data:([^;,]+);base64,(.+)$/);
  if (!partes) throw new Error("Data URL inválido para " + chave + ".");

  const contentType = partes[1].toLowerCase();
  if (!ALLOWED_FILE_TYPES.includes(contentType)) {
    throw new Error("Tipo de arquivo não permitido para " + chave + ".");
  }

  const extensao = contentType === "application/pdf" ? "pdf" : contentType.split("/")[1];
  const nomeSeguro = String(chave).replace(/[^a-zA-Z0-9_-]/g, "_");
  const blob = Utilities.newBlob(Utilities.base64Decode(partes[2]), contentType, nomeSeguro + "." + extensao);
  return obterPastaDocumentos().createFile(blob);
}

// ─── LOG / HISTÓRICO DE ENVIOS ───────────────────────────────────────────────
function registrarLog(tipo, nome, cpf, email, status, mensagem) {
  try {
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const aba = obterPlanilhaDeLog();
      aba.appendRow([new Date(), escaparHtml(tipo), escaparHtml(nome), mascararCpf(cpf), escaparHtml(email), escaparHtml(status), escaparHtml(mensagem)]);
      limparLogsAntigos(aba);
    } finally {
      lock.releaseLock();
    }
  } catch (erroLog) {
    Logger.log("Falha ao registrar log: " + erroLog);
  }
}

function obterPlanilhaDeLog() {

  const props = PropertiesService.getScriptProperties();
  const idSalvo = props.getProperty("LOG_SPREADSHEET_ID");

  let planilha = null;

  if (idSalvo) {
    try {
      planilha = SpreadsheetApp.openById(idSalvo);
    } catch (erroAbrir) {
      planilha = null;
    }
  }

  if (!planilha) {
    planilha = SpreadsheetApp.create("EFFICO - Log de Admissão Digital");
    props.setProperty("LOG_SPREADSHEET_ID", planilha.getId());
  }

  let aba = planilha.getSheetByName(LOG_SHEET_NAME);

  if (!aba) {
    aba = planilha.insertSheet(LOG_SHEET_NAME);
    aba.setFrozenRows(1);

    const abaPadrao = planilha.getSheets().find(s => s.getName() !== LOG_SHEET_NAME);
    if (abaPadrao && planilha.getSheets().length > 1) {
      planilha.deleteSheet(abaPadrao);
    }
  }

  const cabecalho = ["Data/Hora", "Tipo", "Nome", "CPF", "E-mail", "Status", "Mensagem"];
  aba.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]);

  return aba;
}

function enviarEmailCLT(dados, fotos) {

  const nome = escaparHtml(dados.nome || "Não informado");
  const cpf = escaparHtml(dados.cpf || "Não informado");
  const email = escaparHtml(dados.email || "Não informado");
  const funcao = escaparHtml(dados.funcao || "Não informado");

  const linksDocumentos = [];
  let checklistHtml = "";

  if (fotos) {

    for (const key in fotos) {

      const conteudo = fotos[key];

      // Documento não informado
      if (
        !conteudo ||
        conteudo === "NÃO POSSUI" ||
        conteudo === "NAO POSSUI"
      ) {

        checklistHtml += `
          <li>
            ❌ <b>${key.replace(/_/g, " ")}</b>: Não informado
          </li>
        `;

        continue;
      }

      // Tamanho da camisa
      if (
        typeof conteudo === "string" &&
        conteudo.startsWith("TAMANHO:")
      ) {

        checklistHtml += `
          <li>
            👕 <b>Tamanho da Camisa:</b> ${conteudo.replace("TAMANHO:", "").trim()}
          </li>
        `;

        continue;
      }

      try {

        if (!conteudo.includes(",")) {
          throw new Error("Formato Base64 inválido");
        }

        const arquivo = criarArquivoNoDrive(key, conteudo);
        linksDocumentos.push(arquivo.getUrl());

        checklistHtml += `
          <li>
            ✅ <b>${escaparHtml(key.replace(/_/g, " "))}</b>: Armazenado no Drive
          </li>
        `;

      } catch (erroArquivo) {
        Logger.log(`Erro ao processar ${key}: ${erroArquivo.stack || erroArquivo}`);
        throw new Error("Falha ao armazenar o documento " + key + ".");
      }
    }
  }

  MailApp.sendEmail({
    to: "recursoshumanos.dho@effico.com.br",
    cc: "fernanda.simone@effico.com.br,marli.valente@effico.com.br",
    bcc: "alvaro.santos@effico.com.br",
    subject: `📄 Nova Admissão (CLT) - ${nome}`,

    htmlBody: `
    <div style="
      font-family:Arial,sans-serif;
      max-width:700px;
      padding:20px;
      border:1px solid #ddd;
      border-radius:12px;
    ">

      <h2 style="
        color:#0f2a44;
        margin-bottom:20px;
      ">
        Nova Admissão Recebida (CLT)
      </h2>

      <p>
        <b>Nome:</b> ${nome}
      </p>

      <p>
        <b>CPF:</b> ${cpf}
      </p>

      <p>
        <b>E-mail:</b> ${email}
      </p>

      <p>
        <b>Função:</b> ${funcao}
      </p>

      <hr>

      <h3>Documentos enviados</h3>

      <ul style="
        line-height:2;
        padding-left:20px;
      ">
        ${checklistHtml}
      </ul>

      <p><b>Acesso aos documentos:</b> Os arquivos foram armazenados no Drive corporativo.</p>
      ${linksDocumentos.map(url => `<p><a href="${escaparHtml(url)}">Abrir documento</a></p>`).join("")}

      <hr>

      <p style="
        font-size:12px;
        color:#666;
      ">
        Este envio foi realizado através do sistema de admissão digital EFFICO.
      </p>

    </div>
    `,

  });
}

function enviarEmailPJ(dados, fotos) {

  const nome = escaparHtml(dados.nome || "Não informado");
  const linksDocumentos = [];
  let checklistHtml = "";

  for (const key in (fotos || {})) {
    const conteudo = fotos[key];
    try {
      if (typeof conteudo !== "string" || !conteudo.includes(",")) {
        throw new Error("Formato Base64 inválido");
      }
      const arquivo = criarArquivoNoDrive(key, conteudo);
      linksDocumentos.push(arquivo.getUrl());
      checklistHtml += `<li>✅ <b>${escaparHtml(key.replace(/_/g, " "))}</b>: Armazenado no Drive</li>`;
    } catch (erroArquivo) {
      Logger.log(`Erro ao processar anexo PJ ${key}: ${erroArquivo.stack || erroArquivo}`);
      throw new Error("Falha ao armazenar o documento " + key + ".");
    }
  }

  let camposHtml = "";

  PJ_ORDEM.forEach(key => {
    camposHtml += `
      <p>
        <b>${escaparHtml(PJ_LABELS[key])}:</b> ${escaparHtml(dados[key] || "Não informado")}
      </p>
    `;
  });

  MailApp.sendEmail({
    to: "fernanda.simone@effico.com.br",
    cc: "recursoshumanos.dho@effico.com.br,marli.valente@effico.com.br",
    bcc: "alvaro.santos@effico.com.br",
    subject: `📄 Novo Cadastro PJ - ${nome}`,

    htmlBody: `
    <div style="
      font-family:Arial,sans-serif;
      max-width:700px;
      padding:20px;
      border:1px solid #ddd;
      border-radius:12px;
    ">

      <h2 style="
        color:#0f2a44;
        margin-bottom:20px;
      ">
        Novo Cadastro PJ Recebido
      </h2>

      ${camposHtml}

      <hr>

      <h3>Documentos do contrato</h3>

      <ul style="line-height:2;padding-left:20px;">
        ${checklistHtml || "<li>Nenhum documento anexado</li>"}
      </ul>

      <p><b>Acesso aos documentos:</b> Os arquivos foram armazenados no Drive corporativo.</p>
      ${linksDocumentos.map(url => `<p><a href="${escaparHtml(url)}">Abrir documento</a></p>`).join("")}

      <hr>

      <p style="
        font-size:12px;
        color:#666;
      ">
        Este envio foi realizado através do sistema de admissão digital EFFICO.
      </p>

    </div>
    `,
  });
}
