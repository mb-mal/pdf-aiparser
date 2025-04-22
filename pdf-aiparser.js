const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const { PDFDocument } = require('pdf-lib');
const { fromPath } = require('pdf2pic');
const axios = require('axios');

// Configuration
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000; // 5 seconds
const OLLAMA_HOST='192.168.1.91';
const OLLAMA_PORT='11434';
const OLLAMA_URL = `http://${OLLAMA_HOST}:${OLLAMA_PORT}/api/generate`;
const OLLAMA_MODEL = 'gemma3:27b-it-qat';
const TARGET_LANGUAGE= 'Chinese';
async function processPDF(pdfPath, options = {}) {
    try {
        console.log(`Starting PDF processing for file: ${pdfPath}`);
        
        // Default options
        const defaultOptions = {
            startPage: 1,
            endPage: Number.MAX_SAFE_INTEGER,
            timeout: 60000, // 60 seconds timeout for API calls
        };
        
        const config = { ...defaultOptions, ...options };
        console.log(`Configuration: Start page: ${config.startPage}, End page: ${config.endPage === Number.MAX_SAFE_INTEGER ? "last" : config.endPage}`);
        
        // Create base directory for this PDF
        const pdfName = path.basename(pdfPath, path.extname(pdfPath));
        const baseDir = path.join(process.cwd(), 'processed_pdfs', pdfName);
        const imagesDir = path.join(baseDir, 'images');
        const jsonDir = path.join(baseDir, 'json');
        
        // Create necessary directories
        [baseDir, imagesDir, jsonDir].forEach(dir => {
            if (!fs.existsSync(dir)) {
                console.log(`Creating directory: ${dir}`);
                fs.mkdirSync(dir, { recursive: true });
            }
        });

        // Check for existing JSON files to determine last processed page
        const existingJsonFiles = fs.readdirSync(jsonDir)
            .filter(file => file.endsWith('.json'))
            .map(file => {
                const match = file.match(/page_(\d+)\.json$/);
                return match ? parseInt(match[1]) : NaN;
            })
            .filter(pageNum => !isNaN(pageNum))
            .sort((a, b) => a - b);
        
        const lastProcessedPage = existingJsonFiles.length > 0 ? Math.max(...existingJsonFiles) : 0;
        console.log(`Last processed page: ${lastProcessedPage}`);
        
        // Read PDF file
        console.log('Reading PDF file...');
        const dataBuffer = fs.readFileSync(pdfPath);
        
        // Load PDF document with pdf-lib (more reliable for page counts)
        console.log('Loading PDF document...');
        const pdfDoc = await PDFDocument.load(dataBuffer);
        const pages = pdfDoc.getPages();
        const pageCount = pages.length;
        console.log(`Successfully loaded ${pageCount} pages`);
        
        // Determine page range to process
        let startPageIndex, endPageIndex;

        // If startPage and endPage were provided in CLI arguments, use them
        if (options.startPage !== defaultOptions.startPage || options.endPage !== defaultOptions.endPage) {
            // User explicitly set page range in command line - prioritize these values
            startPageIndex = config.startPage - 1; // Zero-based index
            endPageIndex = Math.min(pageCount - 1, config.endPage - 1);
            console.log(`Using command line specified page range...`);
        } else {
            // No explicit page range in command line - continue from last processed page
            startPageIndex = Math.max(lastProcessedPage, config.startPage - 1);
            endPageIndex = Math.min(pageCount - 1, config.endPage - 1);
            console.log(`Continuing from last processed page...`);
        }

        // Validate the page range
        if (startPageIndex > endPageIndex) {
            throw new Error(`Invalid page range: start page (${startPageIndex + 1}) is greater than end page (${endPageIndex + 1})`);
        }

        console.log(`Will process pages from ${startPageIndex + 1} to ${endPageIndex + 1}`);
        
        // Configure pdf2pic
        console.log('Configuring PDF to image converter...');
        const convert = fromPath(pdfPath, {
            density: 150, // Increased density for better quality
            saveFilename: "page",
            savePath: imagesDir,
            format: "png",
            width: 1600, // Larger images for better text recognition
            height: 1600
        });

        // Process pages
        for (let i = startPageIndex; i <= endPageIndex; i++) {
            const pageNumber = i + 1;
            console.log(`\n----------------------------------------------`);
            console.log(`Processing page ${pageNumber}/${pageCount} (${Math.round((i - startPageIndex + 1) / (endPageIndex - startPageIndex + 1) * 100)}% complete)...`);
            
            // Skip if JSON already exists for this page and we're not explicitly processing a user-specified range
            const jsonPath = path.join(jsonDir, `page_${pageNumber}.json`);
            const isExplicitPageRange = (options.startPage !== defaultOptions.startPage || options.endPage !== defaultOptions.endPage);
            if (fs.existsSync(jsonPath) && !isExplicitPageRange) {
                console.log(`Page ${pageNumber} already processed, skipping...`);
                continue;
            }
            
            try {
                // Extract text from the page using a better approach
                console.log('Extracting text...');
                let text = '';
                
                try {
                    // Try method 1: Create a temporary single-page PDF
                    const tempPdfDoc = await PDFDocument.create();
                    const [copiedPage] = await tempPdfDoc.copyPages(pdfDoc, [i]);
                    tempPdfDoc.addPage(copiedPage);
                    
                    const tempPdfBytes = await tempPdfDoc.save();
                    const tempPdfPath = path.join(baseDir, `temp_page_${pageNumber}.pdf`);
                    fs.writeFileSync(tempPdfPath, tempPdfBytes);
                    
                    // Parse just this page's text with simpler options
                    const tempBuffer = fs.readFileSync(tempPdfPath);
                    const tempPdfData = await pdfParse(tempBuffer, { max: 10 });
                    text = tempPdfData.text || '';
                    
                    // Delete the temporary file
                    fs.unlinkSync(tempPdfPath);
                } catch (textExtractionError) {
                    console.warn(`Warning: First text extraction method failed: ${textExtractionError.message}`);
                    
                    // Fallback method: Parse full PDF and try to slice out relevant part
                    console.log('Attempting fallback text extraction...');
                    try {
                        // Parse options to ignore errors
                        const parseOptions = { max: pageCount };
                        const pdfData = await pdfParse(dataBuffer, parseOptions);
                        
                        // Try to find page breaks in the text
                        const fullText = pdfData.text || '';
                        const textBlocks = fullText.split(/\f|\n{3,}/); // Split by form feed or multiple newlines
                        
                        if (textBlocks.length >= pageNumber) {
                            text = textBlocks[pageNumber - 1] || '';
                        } else {
                            text = `[Unable to extract text reliably for page ${pageNumber}]`;
                        }
                    } catch (fallbackError) {
                        console.warn(`Warning: Fallback text extraction failed: ${fallbackError.message}`);
                        text = `[Text extraction failed for page ${pageNumber}]`;
                    }
                }
                
                // Validate that text is a string
                if (typeof text !== 'string') {
                    console.warn(`Warning: Extracted text is not a string, converting to string representation`);
                    try {
                        // Try to stringify if it's an object
                        if (text && typeof text === 'object') {
                            // Check if it has a text property
                            if (text.text) {
                                text = text.text;
                            } else {
                                text = JSON.stringify(text);
                            }
                        } else {
                            text = String(text || '');
                        }
                    } catch (e) {
                        text = `[Text conversion failed: ${e.message}]`;
                    }
                }
                
                console.log(`Extracted ${text.length} characters of text`);
                if (text.length < 10) {
                    console.warn(`Warning: Very little text extracted from page ${pageNumber}. The page may be an image, contain non-text elements, or have extraction issues.`);
                }
                
                // Convert page to PNG
                console.log('Converting page to PNG...');
                const pngPath = path.join(imagesDir, `page.${pageNumber}.png`);
                await convert(pageNumber);
                console.log(`Saved image to: ${pngPath}`);
                
                // Read the generated PNG file
                console.log('Reading PNG file...');
                const imageBuffer = fs.readFileSync(pngPath);
                
                // Get image description from Ollama with retries
                console.log('Getting image description from Ollama...');
                let imageDescription = null;
                let retryCount = 0;
                
                while (retryCount < MAX_RETRIES) {
                    try {
                        imageDescription = await getImageDescription(imageBuffer, config.timeout);
                        break; // Success, exit retry loop
                    } catch (apiError) {
                        retryCount++;
                        console.error(`Attempt ${retryCount}/${MAX_RETRIES} failed: ${apiError.message}`);
                        
                        if (retryCount < MAX_RETRIES) {
                            console.log(`Retrying in ${RETRY_DELAY/1000} seconds...`);
                            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
                        } else {
                            imageDescription = `[Failed to get image description after ${MAX_RETRIES} attempts]`;
                        }
                    }
                }
                
                console.log('\nOllama Response:');
                console.log(JSON.stringify(imageDescription, null, 2));
                console.log('\n');
                
                // Save individual page result
                const pageResult = {
                    pageNumber,
                    text,
                    imageDescription
                };
                
                // Save to individual JSON file
                fs.writeFileSync(jsonPath, JSON.stringify(pageResult, null, 2));
                console.log(`Saved page ${pageNumber} result to ${jsonPath}`);
                
                console.log(`Completed processing page ${pageNumber}`);
            } catch (pageError) {
                console.error(`Error processing page ${pageNumber}:`, pageError.message);
                // Log the error to a file
                const errorLog = path.join(baseDir, 'error_log.txt');
                fs.appendFileSync(errorLog, `Error on page ${pageNumber}: ${pageError.message}\n${pageError.stack}\n\n`);
                console.log(`Error details written to ${errorLog}`);
                // Continue with next page
            }
        }
        
        // Combine all JSON files into one
        console.log('\nCombining all page results...');
        const allResults = [];
        for (let i = 0; i < pageCount; i++) {
            const pageNumber = i + 1;
            const jsonPath = path.join(jsonDir, `page_${pageNumber}.json`);
            if (fs.existsSync(jsonPath)) {
                const pageResult = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
                allResults.push(pageResult);
            }
        }
        
        // Save combined results
        const combinedPath = path.join(baseDir, 'combined_results.json');
        fs.writeFileSync(combinedPath, JSON.stringify(allResults, null, 2));
        console.log(`Saved combined results to ${combinedPath}`);
        
        console.log('\nPDF processing completed successfully');
        return allResults;
    } catch (error) {
        console.error('Error processing PDF:', error);
        throw error;
    }
}

async function getImageDescription(imageBuffer, timeout = 60000) {
    if (!Buffer.isBuffer(imageBuffer)) {
        throw new Error('Input must be a buffer');
    }

    // Convert buffer to base64
    const base64Image = imageBuffer.toString('base64');
    
    // Prepare request body
    const requestBody = {
        model: OLLAMA_MODEL,
        prompt: `give detailed description of page. Pay attention to the details and elements. No commentary allowed. Only page content in ${TARGET_LANGUAGE} language.`,
        images: [base64Image],
        stream: false
    };

    console.log('Sending request to Ollama');
    const response = await axios.post(OLLAMA_URL, 
        requestBody, 
        {
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: timeout // Add timeout to prevent hanging
        }
    );
    
    console.log('Received response from Ollama');
    return response.data.response;
}

// Main execution
if (process.argv.length < 3) {
    console.error('Please provide a PDF file path as an argument');
    console.error('Usage: node index.js <pdf-file> [startPage] [endPage]');
    process.exit(1);
}

const pdfPath = process.argv[2];
const startPage = process.argv[3] ? parseInt(process.argv[3]) : 1;
const endPage = process.argv[4] ? parseInt(process.argv[4]) : Number.MAX_SAFE_INTEGER;

console.log(`Starting application with PDF: ${pdfPath}`);

processPDF(pdfPath, { startPage, endPage })
    .then(results => {
        console.log('\nFinal Results:');
        console.log(`Processed ${results.length} pages successfully`);
    })
    .catch(error => {
        console.error('Fatal Error:', error);
        process.exit(1); 
    });