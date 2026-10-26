const nonClaimWords = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'about',
  'be',
  'been',
  'before',
  'based',
  'being',
  'but',
  'by',
  'can',
  'could',
  'each',
  'for',
  'from',
  'had',
  'has',
  'have',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'may',
  'might',
  'of',
  'on',
  'only',
  'or',
  'that',
  'the',
  'their',
  'them',
  'these',
  'they',
  'this',
  'those',
  'to',
  'was',
  'were',
  'which',
  'while',
  'who',
  'will',
  'with',
  'without',
  'would',
]);

const irregularClaimTokens = new Map([
  ['lost', 'lose'],
  ['losing', 'lose'],
  ['losses', 'loss'],
  ['people', 'person'],
]);

export function claimClauses(value) {
  return value
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .split(/(?:\r?\n)+|(?<=[.!?;:])\s+|\s+(?:and|but)\s+/i)
    .map((clause) =>
      (clause.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
        .map(normalizeClaimToken)
        .filter((token) => token.length > 1 && !nonClaimWords.has(token)),
    )
    .filter((tokens) => tokens.length > 0);
}

function normalizeClaimToken(token) {
  const irregular = irregularClaimTokens.get(token);
  if (irregular) return irregular;
  if (token.length > 5 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 5 && token.endsWith('ing')) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith('ed')) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith('s')) return token.slice(0, -1);
  return token;
}

export function citationClaimText(generated, allowedCitationChunkIds) {
  const allowedIds = new Set(allowedCitationChunkIds);
  let invalidCitation = false;
  let removedCitation = false;
  const claimText = generated.replace(
    /\[([^\r\n[\]]*)(\]|(?=\r?\n|$))/g,
    (marker, id, closing, offset) => {
      // Production chunk IDs are UUIDs. Ordinary Markdown brackets remain claim text.
      const citationShaped = /[0-9a-f]{8}-[0-9a-f-]{27,}/i.test(id);
      const mentionsAllowedId = allowedIds.has(id.trim());
      if (!citationShaped && !mentionsAllowedId) return marker;
      if (
        !allowedIds.has(id) ||
        closing !== ']' ||
        generated[offset - 1] === '[' ||
        generated[offset + marker.length] === ']'
      ) {
        invalidCitation = true;
        return marker;
      }
      // Do not erase a Markdown link label or escaped literal as citation metadata.
      if (generated[offset + marker.length] === '(' || generated[offset - 1] === '\\')
        return marker;
      removedCitation = true;
      return ' ';
    },
  );
  return {
    claimText,
    invalid: invalidCitation || (removedCitation && claimClauses(claimText).length === 0),
  };
}

// Supplied passages remain intact: line breaks or punctuation may carry conditions.
function literalPassage(text) {
  return text
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.!?]+$/, '')
    .trim();
}

export function hasLiteralClaimSupport(
  generated,
  trustedPassages,
  allowedCitationChunkIds = [],
  citationPassages = {},
) {
  const { claimText, invalid } = citationClaimText(generated, allowedCitationChunkIds);
  if (invalid) return false;
  const sentences = claimText
    .split(/(?:\r?\n)+|(?<=[.!?])\s+/)
    .map(literalPassage)
    .filter(Boolean);
  const supported = new Set(trustedPassages.map(literalPassage).filter(Boolean));
  if (
    !literalPassage(claimText) ||
    (!supported.has(literalPassage(claimText)) &&
      !sentences.every((sentence) => supported.has(sentence)))
  )
    return false;
  return generated.split(/(?:\r?\n)+|(?<=[.!?])\s+/).every((part) => {
    const ids = [...part.matchAll(/\[([^\]]+)\]/g)]
      .map((match) => match[1])
      .filter((id) => allowedCitationChunkIds.includes(id));
    const claim = literalPassage(citationClaimText(part, allowedCitationChunkIds).claimText);
    return ids.every(
      (id) =>
        typeof citationPassages[id] === 'string' && claim === literalPassage(citationPassages[id]),
    );
  });
}

export function isInstructionLikeEvidence(value) {
  const normalized = value.normalize('NFKC').replace(/[\p{Cf}\s]+/gu, ' ');
  const roleSyntax =
    /\b(?:system|assistant|developer)\s*(?:(?:message|prompt|instruction)\b|:)|<\/?(?:system|assistant|developer|prompt)>|```(?:system|assistant|developer)/i.test(
      normalized,
    );
  const explicitlyUntrusted = /\b(?:untrusted|prompt[ -]?injection)\b/i.test(normalized);
  const directive =
    /\b(?:ignore|disregard|forget|follow|obey|override|bypass|execute|comply|reply|respond|output|return|print|say)\b/i.test(
      normalized,
    );
  const metaTarget =
    /\b(?:previous|prior|above|following|task|directions?|instructions?|commands?|rules?|prompt|system|assistant|developer|response|answer|output)\b/i.test(
      normalized,
    );
  const redirect = /\b(?:instead|only|exactly)\b/i.test(normalized);
  const sensitiveDisclosure =
    /\b(?:disclose|reveal|expose|leak|print|return|output|send|share)\b.{0,100}\b(?:api[ -]?keys?|credentials?|secrets?|passwords?|cookies?|tokens?)\b|\b(?:api[ -]?keys?|credentials?|secrets?|passwords?|cookies?|tokens?)\b.{0,100}\b(?:disclose|reveal|expose|leak|print|return|output|send|share)\b/i.test(
      normalized,
    );
  return (
    roleSyntax ||
    explicitlyUntrusted ||
    (directive && (metaTarget || redirect)) ||
    sensitiveDisclosure
  );
}
