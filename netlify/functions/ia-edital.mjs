import { withLambda } from "@netlify/aws-lambda-compat";
import resumo from "./lib/ia-edital.js";

// O runtime moderno fornece o contexto Blobs completo, incluindo o endpoint
// sem cache necessário às leituras fortes e às reservas por ETag.
export default withLambda(resumo.handler);
