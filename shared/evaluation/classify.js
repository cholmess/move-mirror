export function isVerifiedStatus(status) {
  return (
    status === "verified_best" ||
    status === "verified_acceptable" ||
    status === "playable_inexact" ||
    status === "incorrect"
  );
}

export function affectsDomain(status) {
  return status !== "unverified" && status !== "illegal";
}

export function isSuccessForAdaptive(status) {
  return status === "verified_best" || status === "verified_acceptable";
}

export function worsensMateSequence(best, played) {
  if (best.mate !== null && best.mate > 0) {
    if (played.mate === null) return true;
    if (played.mate > 0 && played.mate > best.mate) return true;
  }
  if (played.mate !== null && played.mate < 0) return true;
  return false;
}

export function classifyEngineResult(input) {
  const { playedUci, referenceBestUci, best, played, cpLoss } = input;

  if (
    referenceBestUci &&
    playedUci.toLowerCase() === referenceBestUci.toLowerCase()
  ) {
    return "verified_best";
  }

  if (
    best.firstMoveUci &&
    playedUci.toLowerCase() === best.firstMoveUci.toLowerCase()
  ) {
    return "verified_best";
  }

  if (cpLoss === null) return "unverified";

  if (worsensMateSequence(best.score, played.score)) {
    return "incorrect";
  }

  if (cpLoss <= 0) return "verified_best";
  if (cpLoss <= 50) return "verified_acceptable";
  if (cpLoss <= 120) return "playable_inexact";
  return "incorrect";
}

export function pedagogicalLabel(status) {
  switch (status) {
    case "verified_best":
      return "Óptima";
    case "verified_acceptable":
      return "Aceptable";
    case "playable_inexact":
      return "Imprecisa";
    case "incorrect":
      return "Incorrecta";
    case "unverified":
      return "No verificada";
    case "illegal":
      return "Ilegal";
  }
}
