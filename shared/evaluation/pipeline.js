import { classifyEngineResult } from "./classify.js";

export function classifyFromLayers({
  fen,
  playedUci,
  referenceBestUci,
  shallow,
  deep,
}) {
  const layer = deep ?? shallow;
  const cpLoss = layer.cpLoss;

  const initialStatus = classifyEngineResult({
    fen,
    playedUci,
    referenceBestUci,
    best: shallow.best,
    played: shallow.played,
    cpLoss: shallow.cpLoss,
  });

  const finalStatus = classifyEngineResult({
    fen,
    playedUci,
    referenceBestUci,
    best: (deep ?? shallow).best,
    played: (deep ?? shallow).played,
    cpLoss,
  });

  return { initialStatus, finalStatus, cpLoss, layer: deep ? "deep" : "shallow" };
}
