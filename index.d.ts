import { SourceLocation } from '@babel/types';
interface MessageDescriptor {
    id: string;
    defaultMessage?: string;
    description?: string;
}
export type ExtractedMessageDescriptor = MessageDescriptor & Partial<SourceLocation> & {
    file?: string;
};
export type ExtractionResult<M = Record<string, string>> = {
    messages: ExtractedMessageDescriptor[];
    meta: M;
};
/**
 *
 * @param workspaceRoot
 * @param messagesDir
 * @param filename Absolute path to the file
 */
export declare function resolveOutputPath(workspaceRoot: string, messagesDir: string, filename: string): string;
declare const _default: any;
export default _default;
export { OptionsSchema } from './options';
//# sourceMappingURL=index.d.ts.map