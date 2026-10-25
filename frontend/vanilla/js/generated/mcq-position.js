export const MCQ_FINAL_STAGE = 'reasoned';
export function mcqActivePosition(questions, requested) {
    if (Number.isInteger(requested) && requested >= 1 && requested <= questions.length)
        return requested;
    const firstUnfinished = questions.findIndex((question) => question.stage !== MCQ_FINAL_STAGE);
    if (questions.length === 0)
        return 0;
    return firstUnfinished === -1 ? 1 : firstUnfinished + 1;
}
