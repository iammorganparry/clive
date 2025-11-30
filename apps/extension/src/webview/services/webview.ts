import { Layer } from "effect";
import { AuthServiceLive } from "./auth-service.js";

export const WebviewLive = Layer.merge(AuthServiceLive);
