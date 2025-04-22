# PDF AI Parser

A Node.js tool for processing PDF documents with AI-powered image and text analysis.

## Overview

PDF AI Parser extracts text and images from PDF documents and leverages Ollama's AI capabilities to generate detailed descriptions of each page. The tool is designed to handle complex PDFs, including those with mixed content, and can process documents page by page with robust error handling.

## Features

- Extract text from PDF pages
- Convert PDF pages to PNG images
- Generate AI-powered descriptions of page content using Ollama
- Resume processing from the last completed page
- Support for specifying page ranges
- Comprehensive error handling and retry mechanisms
- Output in structured JSON format
- Support for translation to other languages (currently configured for Chinese)

## Prerequisites

- Node.js (v14 or newer recommended)
- Ollama server running locally or on a remote machine
- Sufficient disk space for PDF processing and image storage

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/mb-mal/pdf-aiparser.git
   cd pdf-aiparser
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Make sure Ollama is running with the required model (default: gemma3:27b-it-qat).

## Usage

### Basic Usage

```bash
node pdf-aiparser.js /path/to/your/document.pdf
```

### Process Specific Page Range

```bash
node pdf-aiparser.js /path/to/your/document.pdf 5 10
```
This will process pages 5 through 10 inclusive.

### Configuration

Edit the following constants in the script to customize behavior:

- `MAX_RETRIES`: Number of retry attempts for API calls (default: 3)
- `RETRY_DELAY`: Delay between retries in milliseconds (default: 5000)
- `OLLAMA_HOST`: Hostname for Ollama API (default: 'localhost')
- `OLLAMA_PORT`: Port for Ollama API (default: '11434')
- `OLLAMA_MODEL`: Ollama model to use (default: 'gemma3:27b-it-qat')
- `TARGET_LANGUAGE`: Language for AI descriptions (default: 'Chinese')

## Output Structure

The tool creates the following directory structure for each processed PDF:

```
processed_pdfs/
└── [pdf_name]/
    ├── images/
    │   ├── page.1.png
    │   ├── page.2.png
    │   └── ...
    ├── json/
    │   ├── page_1.json
    │   ├── page_2.json
    │   └── ...
    ├── combined_results.json
    └── error_log.txt (if errors occurred)
```

Each page's JSON file contains:
- Page number
- Extracted text
- AI-generated description of the page content

## Error Handling

The tool implements various error handling strategies:
- Multiple text extraction methods with fallbacks
- API call retries with configurable delays
- Detailed error logging to error_log.txt
- Continuation of processing despite individual page failures

## Dependencies

- pdf-parse: For extracting text from PDFs
- pdf-lib: For handling PDF documents
- pdf2pic: For converting PDF pages to images
- axios: For making HTTP requests to the Ollama API

## License

[MIT License](LICENSE)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.