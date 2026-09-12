import { withLambda } from "@netlify/aws-lambda-compat";
// Imports explícitos mantêm no pacote as dependências usadas pelos requires
// opcionais do handler CommonJS, que o rastreador não encontra após a conversão.
import "@netlify/blobs";
import "pdf-parse";
import "adm-zip";
import "mammoth";
import "js-tiktoken/lite";
import "js-tiktoken/ranks/o200k_base";
import resumo from "./lib/ia-edital.js";

// O runtime moderno fornece o contexto Blobs completo, incluindo o endpoint
// sem cache necessário às leituras fortes e às reservas por ETag.
export default withLambda(resumo.handler);
