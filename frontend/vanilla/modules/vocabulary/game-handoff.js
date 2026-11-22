/**
 * Derive the next word from a server-saved attempt without inventing progress.
 * The shared source order is carried inside each attempt's state, never in
 * browser-local persistent storage.
 */
export function nextHandoffWord(gameId, state = {}, sourceDeck = []) {
  if (!Array.isArray(sourceDeck) || sourceDeck.length === 0) return null;
  const deck = gameId === 'match' ? state.left : state.deck;
  if (!Array.isArray(deck) || deck.length === 0) return sourceDeck[0];
  if (gameId === 'match') {
    const matched = new Set(Array.isArray(state.matched) ? state.matched : []);
    const pending = deck.find(id => !matched.has(id) && sourceDeck.includes(id));
    if (pending) return pending;
  } else {
    const index = gameId === 'race' && state.finished === true
      ? deck.length : Number.isSafeInteger(state.index)
        ? Math.max(0, Math.min(state.index, deck.length)) : 0;
    if (index < deck.length && sourceDeck.includes(deck[index])) return deck[index];
  }
  const final = deck.at(-1);
  const next = sourceDeck.indexOf(final) + 1;
  return next > 0 && next < sourceDeck.length ? sourceDeck[next] : null;
}

/** The API accepts at most 24 explicitly selected words for non-card games. */
export function handoffSlice(sourceDeck, cursor, limit = 24) {
  if (!Array.isArray(sourceDeck) || !sourceDeck.includes(cursor)) return [];
  return sourceDeck.slice(sourceDeck.indexOf(cursor), sourceDeck.indexOf(cursor) + Math.min(24, Math.max(1, limit)));
}

/** Includes previously played words and non-linear matching pairs without data loss. */
export function completedHandoffWords(gameId,attempt,sourceDeck=[]) {
  const state=attempt?.state??{},all=new Set(sourceDeck),
    completed=new Set(Array.isArray(state._handoff?.completed)?state._handoff.completed:[]);
  if(gameId==='match'){
    for(const id of Array.isArray(state.matched)?state.matched:[])completed.add(id);
  }else{
    const deck=Array.isArray(state.deck)?state.deck:[],
      index=gameId==='race'&&state.finished===true?deck.length:
        Number.isSafeInteger(state.index)?Math.max(0,Math.min(deck.length,state.index)):0;
    for(const id of deck.slice(0,index))completed.add(id);
  }
  return [...completed].filter(id=>all.has(id));
}

export function handoffSourceDeck(attempt, fallback = []) {
  const stored = attempt?.state?._handoff?.sourceDeck;
  const source = Array.isArray(stored) && stored.length ? stored : (
    Array.isArray(attempt?.state?.deck) && attempt.state.deck.length
      ? attempt.state.deck
      : Array.isArray(attempt?.deck) && attempt.deck.length ? attempt.deck : fallback
  );
  return [...new Set(source.filter(id => typeof id === 'string'))].slice(0, 500);
}

export function mergeHandoffState(gameId, state, sourceDeck, batchIndex) {
  const prior = state?._handoff?.sourceDeck;
  // A fresh flashcard pass may shuffle its deck; that is the order to preserve.
  const roundOrder = state?.deck;
  const canonical = Array.isArray(prior) && prior.length ? prior :
    gameId === 'cards' && Array.isArray(roundOrder) && roundOrder.length
      ? [...roundOrder,...sourceDeck.filter(id => !roundOrder.includes(id))]
      : sourceDeck;
  return {
    ...state,
    _handoff: {
      sourceDeck: canonical,
      ...(Array.isArray(state?._handoff?.completed)
        ? {completed:state._handoff.completed.filter(id=>canonical.includes(id))} : {}),
      ...(Number.isSafeInteger(batchIndex) ? {batchIndex} : {})
    }
  };
}
