import { parse } from '@babel/parser';
export class ASTIndexer {
    parse(code) {
        if (!code || typeof code !== 'string') {
            return { type: 'File', program: { body: [] } };
        }
        try {
            return parse(code, {
                sourceType: 'module',
                plugins: ['typescript', 'jsx']
            });
        }
        catch (e) {
            return { type: 'File', program: { body: [] } };
        }
    }
    index(code) {
        return this.parse(code);
    }
}
export default ASTIndexer;
