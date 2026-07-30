export interface GeneratedCode {
  language: string;
  purpose: string;
  structure: string;
}


export class CodeGenerator {

  generate(
    language: string,
    purpose: string
  ): GeneratedCode {

    return {
      language,
      purpose,
      structure:
        "Generated following architecture principles"
    };

  }

}
