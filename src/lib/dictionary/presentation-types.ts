import type {Sense} from './model';
export type RelatedMeaning={text:string;lexemeId?:string;senseId?:string};
export type SensePresentation={synonyms:RelatedMeaning[];collocations:RelatedMeaning[];examples:Sense['examples']};
export type EntryPresentation={senses:Record<string,SensePresentation>};
export type StoredPresentation={contentSha:string;senses:Record<string,Omit<SensePresentation,'examples'>&{meaningSha:string;exampleIds:string[];addedExamples?:Sense['examples']} >};
