import type { FastifyInstance } from "fastify";
import { registerStoryRoutes } from "./stories";
import { registerRunRoutes } from "./runs";
import { registerPageImageRoutes } from "./pageImages";
import { registerTtsRoutes } from "./tts";
import { registerHotspotRoutes } from "./hotspots";
import { registerSettingsRoutes } from "./settings";

export function registerRoutes(app: FastifyInstance): void {
  registerStoryRoutes(app);
  registerRunRoutes(app);
  registerPageImageRoutes(app);
  registerTtsRoutes(app);
  registerHotspotRoutes(app);
  registerSettingsRoutes(app);
}
