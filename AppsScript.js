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

function doPost(e) {

  let tipo = "desconhecido";
  let nome = "Não informado";
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
    Logger.log("Payload recebido: " + e.postData.contents.length + " caracteres");

    const data = JSON.parse(e.postData.contents);

    if (!data.dados) {
      throw new Error("Dados do candidato não encontrados.");
    }

    tipo = data.tipo === "PJ" ? "PJ" : "CLT";
    nome = data.dados.nome || "Não informado";

    if (tipo === "PJ") {
      enviarEmailPJ(data.dados);
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
    mensagem = error.toString();

    return ContentService
      .createTextOutput(
        JSON.stringify({
          status: "error",
          message: mensagem
        })
      )
      .setMimeType(ContentService.MimeType.JSON);

  } finally {

    registrarLog(tipo, nome, status, mensagem);
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

// ─── LOG / HISTÓRICO DE ENVIOS ───────────────────────────────────────────────
function registrarLog(tipo, nome, status, mensagem) {
  try {
    const aba = obterPlanilhaDeLog();
    aba.appendRow([new Date(), tipo, nome, status, mensagem]);
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
    aba.appendRow(["Data/Hora", "Tipo", "Nome", "Status", "Mensagem"]);
    aba.setFrozenRows(1);

    const abaPadrao = planilha.getSheets().find(s => s.getName() !== LOG_SHEET_NAME);
    if (abaPadrao && planilha.getSheets().length > 1) {
      planilha.deleteSheet(abaPadrao);
    }
  }

  return aba;
}

function enviarEmailCLT(dados, fotos) {

  const nome = dados.nome || "Não informado";
  const funcao = dados.funcao || "Não informado";

  const anexos = [];
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

        const base64Parts = conteudo.split(",");

        const contentType = base64Parts[0]
          .split(":")[1]
          .split(";")[0];

        const base64Data = base64Parts[1];

        const extensao =
          contentType.split("/")[1] || "jpg";

        const blob = Utilities.newBlob(
          Utilities.base64Decode(base64Data),
          contentType,
          `${key}.${extensao}`
        );

        anexos.push(blob);

        checklistHtml += `
          <li>
            ✅ <b>${key.replace(/_/g, " ")}</b>: Em anexo
          </li>
        `;

      } catch (erroArquivo) {

        Logger.log(
          `Erro ao processar ${key}: ${erroArquivo}`
        );

        checklistHtml += `
          <li>
            ⚠️ <b>${key.replace(/_/g, " ")}</b>: Erro ao processar arquivo
          </li>
        `;
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

      <hr>

      <p style="
        font-size:12px;
        color:#666;
      ">
        Este envio foi realizado através do sistema de admissão digital EFFICO.
      </p>

    </div>
    `,

    attachments: anexos
  });
}

function enviarEmailPJ(dados) {

  const nome = dados.nome || "Não informado";

  let camposHtml = "";

  PJ_ORDEM.forEach(key => {
    camposHtml += `
      <p>
        <b>${PJ_LABELS[key]}:</b> ${dados[key] || "Não informado"}
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

      <p style="
        font-size:12px;
        color:#666;
      ">
        Este envio foi realizado através do sistema de admissão digital EFFICO.
      </p>

    </div>
    `
  });
}
