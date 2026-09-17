// T_SHOP Mobile - ESC/POS Thermal Receipt Builder
// High-performance byte-oriented ESC/POS protocol generator for 58mm & 80mm printers

export type PaperWidth = '58mm' | '80mm';

export class EscPosBuilder {
  private buffer: number[] = [];
  private paperWidth: PaperWidth;
  private maxColumns: number;

  constructor(paperWidth: PaperWidth = '58mm') {
    this.paperWidth = paperWidth;
    this.maxColumns = paperWidth === '58mm' ? 32 : 48;
    this.init();
  }

  // Hardware Reset / Initialize printer
  init(): this {
    this.buffer.push(0x1B, 0x40); // ESC @
    return this;
  }

  // Text Alignment
  alignLeft(): this {
    this.buffer.push(0x1B, 0x61, 0x00); // ESC a 0
    return this;
  }

  alignCenter(): this {
    this.buffer.push(0x1B, 0x61, 0x01); // ESC a 1
    return this;
  }

  alignRight(): this {
    this.buffer.push(0x1B, 0x61, 0x02); // ESC a 2
    return this;
  }

  // Text Styles
  bold(enable: boolean = true): this {
    this.buffer.push(0x1B, 0x45, enable ? 0x01 : 0x00); // ESC E n
    return this;
  }

  underline(enable: boolean = true): this {
    this.buffer.push(0x1B, 0x2D, enable ? 0x01 : 0x00); // ESC - n
    return this;
  }

  doubleSize(enable: boolean = true): this {
    this.buffer.push(0x1D, 0x21, enable ? 0x11 : 0x00); // GS ! n
    return this;
  }

  doubleHeight(enable: boolean = true): this {
    this.buffer.push(0x1D, 0x21, enable ? 0x01 : 0x00);
    return this;
  }

  doubleWidth(enable: boolean = true): this {
    this.buffer.push(0x1D, 0x21, enable ? 0x10 : 0x00);
    return this;
  }

  normalSize(): this {
    this.buffer.push(0x1D, 0x21, 0x00);
    return this;
  }

  // Inverted Black/White print
  invert(enable: boolean = true): this {
    this.buffer.push(0x1D, 0x42, enable ? 0x01 : 0x00); // GS B n
    return this;
  }

  // Line Feeds & Spacing
  feed(lines: number = 1): this {
    this.buffer.push(0x1B, 0x64, Math.max(1, Math.min(255, lines))); // ESC d n
    return this;
  }

  // Cash Drawer Kick pulse (Open drawer on checkout)
  kickCashDrawer(pin: 0 | 1 = 0): this {
    // ESC p m t1 t2
    this.buffer.push(0x1B, 0x70, pin, 0x19, 0xFA);
    return this;
  }

  // Paper Cut
  cutPaper(partial: boolean = false): this {
    this.feed(3);
    this.buffer.push(0x1D, 0x56, partial ? 0x01 : 0x00); // GS V m
    return this;
  }

  // Append raw text with automatic transliteration for legacy thermal printers
  text(str: string, stripDiacritics: boolean = false): this {
    const processed = stripDiacritics ? EscPosBuilder.removeDiacritics(str) : str;
    for (let i = 0; i < processed.length; i++) {
      const code = processed.charCodeAt(i);
      if (code <= 0x7F) {
        this.buffer.push(code);
      } else {
        // UTF-8 multi-byte encoding
        const encoded = encodeURIComponent(processed[i]);
        if (encoded.startsWith('%')) {
          const hexBytes = encoded.split('%').filter(Boolean);
          for (const hex of hexBytes) {
            this.buffer.push(parseInt(hex, 16));
          }
        } else {
          this.buffer.push(code & 0xFF);
        }
      }
    }
    return this;
  }

  line(str: string = '', stripDiacritics: boolean = false): this {
    this.text(str, stripDiacritics);
    this.buffer.push(0x0A); // LF
    return this;
  }

  // Formatted Horizontal Separator Line
  separator(char: string = '-'): this {
    const lineStr = char.repeat(this.maxColumns).slice(0, this.maxColumns);
    return this.line(lineStr);
  }

  doubleSeparator(): this {
    return this.separator('=');
  }

  // Two-column layout (Left-aligned label, Right-aligned value)
  twoColumnLine(left: string, right: string, stripDiacritics: boolean = false): this {
    const cleanLeft = stripDiacritics ? EscPosBuilder.removeDiacritics(left) : left;
    const cleanRight = stripDiacritics ? EscPosBuilder.removeDiacritics(right) : right;

    const availableSpace = this.maxColumns - cleanRight.length;
    if (availableSpace <= 0) {
      this.line(cleanLeft);
      this.alignRight().line(cleanRight).alignLeft();
      return this;
    }

    let leftText = cleanLeft;
    if (leftText.length > availableSpace - 1) {
      leftText = leftText.slice(0, availableSpace - 1);
    }

    const padding = ' '.repeat(this.maxColumns - leftText.length - cleanRight.length);
    return this.line(leftText + padding + cleanRight);
  }

  // Three-column layout (Item Name, Qty x Price, Amount)
  threeColumnItem(name: string, qtyPrice: string, amount: string, stripDiacritics: boolean = false): this {
    const cleanName = stripDiacritics ? EscPosBuilder.removeDiacritics(name) : name;
    const cleanQty = stripDiacritics ? EscPosBuilder.removeDiacritics(qtyPrice) : qtyPrice;
    const cleanAmount = stripDiacritics ? EscPosBuilder.removeDiacritics(amount) : amount;

    // Line 1: Item Name
    this.bold(true).line(cleanName).bold(false);

    // Line 2: "  " + Qty x Price + "     " + Amount
    const indent = '  ';
    const leftPart = indent + cleanQty;
    const paddingLength = Math.max(1, this.maxColumns - leftPart.length - cleanAmount.length);
    const padding = ' '.repeat(paddingLength);

    return this.line(leftPart + padding + cleanAmount);
  }

  // QR Code Generation (Model 2)
  qrCode(content: string, size: number = 6): this {
    const len = content.length + 3;
    const pL = len & 0xFF;
    const pH = (len >> 8) & 0xFF;

    // 1. Set QR Model
    this.buffer.push(0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00);
    // 2. Set Module Size
    this.buffer.push(0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, Math.min(16, Math.max(1, size)));
    // 3. Set Error Correction (M)
    this.buffer.push(0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x31);
    // 4. Store Data
    this.buffer.push(0x1D, 0x28, 0x6B, pL, pH, 0x31, 0x50, 0x30);
    for (let i = 0; i < content.length; i++) {
      this.buffer.push(content.charCodeAt(i));
    }
    // 5. Print QR Code
    this.buffer.push(0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30);
    return this;
  }

  // Compile buffer
  getBytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }

  getBase64(): string {
    const bytes = this.getBytes();
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    // Universal btoa handling
    if (typeof btoa === 'function') {
      return btoa(binary);
    }
    return Buffer.from(bytes).toString('base64');
  }

  getByteCount(): number {
    return this.buffer.length;
  }

  // Vietnamese Diacritic Stripper for legacy thermal printers without Unicode ROM
  static removeDiacritics(str: string): string {
    if (!str) return '';
    return str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .replace(/[^\x00-\x7E]/g, '');
  }
}

export default EscPosBuilder;
