export const readFileAsText = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(event.target?.result as string);
    reader.onerror = (error) => reject(error);
    reader.readAsText(file);
  });
};

export const parseTextBlocks = (rawText: string): string[] => {
  // Regex equivalent to Python's re.split(r'\n(?=\d+\.\s*\n)', raw_text)
  // Splits by newline if followed by a number, a dot, and a newline.
  const parts = rawText.split(/\n(?=\d+\.\s*\n)/);
  
  const blocks: string[] = [];
  parts.forEach((part) => {
    const lines = part.trim().split('\n');
    // If user format expects "1. Title \n Content", we often want to skip the first line (Title)
    // based on the Python script: lines[1:]
    if (lines.length >= 2) {
      blocks.push(lines.slice(1).join('\n').trim());
    } else if (lines.length === 1 && lines[0].trim().length > 0) {
      // Fallback: if only one line, just use it (or handle as user prefers)
      // The python script strictly did lines[1:], so we stick to that logic
      // but if a block is just text without a header, we might lose it. 
      // For safety based on the script provided:
      // blocks.append("\n".join(lines[1:]).strip())
    }
  });
  
  // If parsing failed (no headers found), treat the whole file as one block or split by double newline
  if (blocks.length === 0 && rawText.trim().length > 0) {
     return [rawText.trim()];
  }

  return blocks;
};

export const maskApiKey = (key: string): string => {
  if (key.length < 8) return '****';
  return `${key.substring(0, 4)}...${key.substring(key.length - 4)}`;
};
