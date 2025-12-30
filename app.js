/**
 * WordPress XML to Markdown Converter
 * Converts WordPress export files (WXR format) to Markdown
 */

// ========================================
// DOM Elements
// ========================================
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const fileInfo = document.getElementById('fileInfo');
const fileName = document.getElementById('fileName');
const fileSize = document.getElementById('fileSize');
const removeFileBtn = document.getElementById('removeFile');
const statsSection = document.getElementById('stats-section');
const previewSection = document.getElementById('preview-section');
const loadingSection = document.getElementById('loading-section');
const errorSection = document.getElementById('error-section');
const errorMessage = document.getElementById('errorMessage');
const retryBtn = document.getElementById('retryBtn');
const previewText = document.getElementById('previewText');
const copyBtn = document.getElementById('copyBtn');
const downloadBtn = document.getElementById('downloadBtn');
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toastMessage');

// Stats elements
const postCount = document.getElementById('postCount');
const pageCount = document.getElementById('pageCount');
const categoryCount = document.getElementById('categoryCount');
const tagCount = document.getElementById('tagCount');

// ========================================
// State
// ========================================
let currentFile = null;
let markdownContent = '';
let parsedData = null;

// ========================================
// Event Listeners
// ========================================
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', handleDragOver);
dropZone.addEventListener('dragleave', handleDragLeave);
dropZone.addEventListener('drop', handleDrop);
fileInput.addEventListener('change', handleFileSelect);
removeFileBtn.addEventListener('click', resetUpload);
retryBtn.addEventListener('click', () => processFile(currentFile));
copyBtn.addEventListener('click', copyToClipboard);
downloadBtn.addEventListener('click', downloadMarkdown);

// ========================================
// Drag & Drop Handlers
// ========================================
function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add('dragover');
}

function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('dragover');
}

function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('dragover');
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        handleFile(files[0]);
    }
}

function handleFileSelect(e) {
    const files = e.target.files;
    if (files.length > 0) {
        handleFile(files[0]);
    }
}

// ========================================
// File Handling
// ========================================
function handleFile(file) {
    // Validate file type
    if (!file.name.toLowerCase().endsWith('.xml')) {
        showError('Per favore seleziona un file XML valido.');
        return;
    }
    
    currentFile = file;
    
    // Update UI
    fileName.textContent = file.name;
    fileSize.textContent = formatFileSize(file.size);
    dropZone.hidden = true;
    fileInfo.hidden = false;
    
    // Process file
    processFile(file);
}

async function processFile(file) {
    showLoading();
    
    try {
        const content = await readFile(file);
        parsedData = parseWordPressXML(content);
        markdownContent = generateMarkdown(parsedData);
        
        updateStats(parsedData);
        showPreview(markdownContent);
    } catch (error) {
        console.error('Error processing file:', error);
        showError(error.message || 'Errore durante l\'elaborazione del file.');
    }
}

function readFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = () => reject(new Error('Impossibile leggere il file.'));
        reader.readAsText(file);
    });
}

// ========================================
// WordPress XML Parser
// ========================================
function parseWordPressXML(xmlContent) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlContent, 'text/xml');
    
    // Check for parsing errors
    const parseError = doc.querySelector('parsererror');
    if (parseError) {
        throw new Error('Il file XML non è valido. Assicurati che sia un export WordPress.');
    }
    
    // Get site info
    const channel = doc.querySelector('channel');
    if (!channel) {
        throw new Error('Formato XML non riconosciuto. Assicurati che sia un export WordPress.');
    }
    
    const siteInfo = {
        title: getTextContent(channel, 'title'),
        link: getTextContent(channel, 'link'),
        description: getTextContent(channel, 'description'),
        language: getTextContent(channel, 'language'),
        pubDate: getTextContent(channel, 'pubDate')
    };
    
    // Get categories
    const categories = [];
    const categoryNodes = doc.querySelectorAll('wp\\:category, category');
    categoryNodes.forEach(cat => {
        const name = getTextContent(cat, 'wp\\:cat_name, cat_name') || 
                     getTextContent(cat, 'wp\\:category_nicename, category_nicename');
        if (name) {
            categories.push({
                name: cleanCDATA(name),
                slug: getTextContent(cat, 'wp\\:category_nicename, category_nicename'),
                description: cleanCDATA(getTextContent(cat, 'wp\\:category_description, category_description'))
            });
        }
    });
    
    // Get tags
    const tags = [];
    const tagNodes = doc.querySelectorAll('wp\\:tag, tag');
    tagNodes.forEach(tag => {
        const name = getTextContent(tag, 'wp\\:tag_name, tag_name');
        if (name) {
            tags.push({
                name: cleanCDATA(name),
                slug: getTextContent(tag, 'wp\\:tag_slug, tag_slug')
            });
        }
    });
    
    // Get items (posts and pages)
    const posts = [];
    const pages = [];
    const items = doc.querySelectorAll('item');
    
    items.forEach(item => {
        const postType = getTextContent(item, 'wp\\:post_type, post_type');
        const status = getTextContent(item, 'wp\\:status, status');
        
        // Only include published posts and pages, or drafts
        if (!['post', 'page'].includes(postType)) return;
        
        const itemData = {
            title: cleanCDATA(getTextContent(item, 'title')),
            link: getTextContent(item, 'link'),
            pubDate: getTextContent(item, 'pubDate'),
            creator: cleanCDATA(getTextContent(item, 'dc\\:creator, creator')),
            content: cleanCDATA(getTextContent(item, 'content\\:encoded, encoded')),
            excerpt: cleanCDATA(getTextContent(item, 'excerpt\\:encoded')),
            postId: getTextContent(item, 'wp\\:post_id, post_id'),
            postDate: getTextContent(item, 'wp\\:post_date, post_date'),
            status: status,
            postType: postType,
            categories: [],
            tags: []
        };
        
        // Get categories and tags for this item
        const itemCategories = item.querySelectorAll('category');
        itemCategories.forEach(cat => {
            const domain = cat.getAttribute('domain');
            const name = cleanCDATA(cat.textContent);
            if (domain === 'category' && name) {
                itemData.categories.push(name);
            } else if (domain === 'post_tag' && name) {
                itemData.tags.push(name);
            }
        });
        
        if (postType === 'post') {
            posts.push(itemData);
        } else if (postType === 'page') {
            pages.push(itemData);
        }
    });
    
    // Sort by date (newest first)
    posts.sort((a, b) => new Date(b.postDate) - new Date(a.postDate));
    pages.sort((a, b) => new Date(b.postDate) - new Date(a.postDate));
    
    return {
        siteInfo,
        categories,
        tags,
        posts,
        pages
    };
}

// ========================================
// Helper Functions
// ========================================
function getTextContent(parent, selectors) {
    if (!parent) return '';
    const selectorList = selectors.split(',').map(s => s.trim());
    for (const selector of selectorList) {
        const element = parent.querySelector(selector);
        if (element) {
            return element.textContent || '';
        }
    }
    return '';
}

function cleanCDATA(text) {
    if (!text) return '';
    return text
        .replace(/<!\[CDATA\[/g, '')
        .replace(/\]\]>/g, '')
        .trim();
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDate(dateStr) {
    if (!dateStr) return 'N/A';
    try {
        const date = new Date(dateStr);
        return date.toLocaleDateString('it-IT', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    } catch {
        return dateStr;
    }
}

// ========================================
// HTML to Markdown Converter
// ========================================
function htmlToMarkdown(html) {
    if (!html) return '';
    
    let md = html;
    
    // Remove script and style tags
    md = md.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    md = md.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
    
    // Headers
    md = md.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '\n# $1\n');
    md = md.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '\n## $1\n');
    md = md.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '\n### $1\n');
    md = md.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '\n#### $1\n');
    md = md.replace(/<h5[^>]*>(.*?)<\/h5>/gi, '\n##### $1\n');
    md = md.replace(/<h6[^>]*>(.*?)<\/h6>/gi, '\n###### $1\n');
    
    // Bold and italic
    md = md.replace(/<(strong|b)>(.*?)<\/(strong|b)>/gi, '**$2**');
    md = md.replace(/<(em|i)>(.*?)<\/(em|i)>/gi, '*$2*');
    
    // Links
    md = md.replace(/<a[^>]*href=["']([^"']*)["'][^>]*>(.*?)<\/a>/gi, '[$2]($1)');
    
    // Images
    md = md.replace(/<img[^>]*src=["']([^"']*)["'][^>]*alt=["']([^"']*)["'][^>]*\/?>/gi, '![$2]($1)');
    md = md.replace(/<img[^>]*alt=["']([^"']*)["'][^>]*src=["']([^"']*)["'][^>]*\/?>/gi, '![$1]($2)');
    md = md.replace(/<img[^>]*src=["']([^"']*)["'][^>]*\/?>/gi, '![]($1)');
    
    // Lists
    md = md.replace(/<ul[^>]*>/gi, '\n');
    md = md.replace(/<\/ul>/gi, '\n');
    md = md.replace(/<ol[^>]*>/gi, '\n');
    md = md.replace(/<\/ol>/gi, '\n');
    md = md.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n');
    
    // Blockquotes
    md = md.replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gis, '\n> $1\n');
    
    // Code
    md = md.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`');
    md = md.replace(/<pre[^>]*>(.*?)<\/pre>/gis, '\n```\n$1\n```\n');
    
    // Paragraphs and line breaks
    md = md.replace(/<p[^>]*>/gi, '\n');
    md = md.replace(/<\/p>/gi, '\n');
    md = md.replace(/<br\s*\/?>/gi, '\n');
    md = md.replace(/<hr\s*\/?>/gi, '\n---\n');
    
    // Remove remaining HTML tags
    md = md.replace(/<[^>]+>/g, '');
    
    // Decode HTML entities
    md = decodeHTMLEntities(md);
    
    // Clean up whitespace
    md = md.replace(/\n{3,}/g, '\n\n');
    md = md.trim();
    
    return md;
}

function decodeHTMLEntities(text) {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = text;
    return textarea.value;
}

// ========================================
// Markdown Generator
// ========================================
function generateMarkdown(data) {
    let md = '';
    
    // Site Header
    md += `# ${data.siteInfo.title || 'WordPress Export'}\n\n`;
    
    if (data.siteInfo.description) {
        md += `> ${data.siteInfo.description}\n\n`;
    }
    
    md += `**Sito:** ${data.siteInfo.link || 'N/A'}\n`;
    md += `**Lingua:** ${data.siteInfo.language || 'N/A'}\n`;
    md += `**Data export:** ${formatDate(data.siteInfo.pubDate)}\n\n`;
    
    md += `---\n\n`;
    
    // Summary
    md += `## Riepilogo Contenuti\n\n`;
    md += `- **Articoli:** ${data.posts.length}\n`;
    md += `- **Pagine:** ${data.pages.length}\n`;
    md += `- **Categorie:** ${data.categories.length}\n`;
    md += `- **Tag:** ${data.tags.length}\n\n`;
    
    // Categories
    if (data.categories.length > 0) {
        md += `## Categorie\n\n`;
        data.categories.forEach(cat => {
            md += `- **${cat.name}**`;
            if (cat.description) {
                md += `: ${cat.description}`;
            }
            md += `\n`;
        });
        md += `\n`;
    }
    
    // Tags
    if (data.tags.length > 0) {
        md += `## Tag\n\n`;
        md += data.tags.map(t => `\`${t.name}\``).join(', ') + `\n\n`;
    }
    
    md += `---\n\n`;
    
    // Articles
    if (data.posts.length > 0) {
        md += `# ARTICOLI\n\n`;
        
        data.posts.forEach((post, index) => {
            md += `## ${index + 1}. ${post.title || 'Senza titolo'}\n\n`;
            
            // Metadata
            md += `**Autore:** ${post.creator || 'N/A'}\n`;
            md += `**Data:** ${formatDate(post.postDate)}\n`;
            md += `**Stato:** ${translateStatus(post.status)}\n`;
            
            if (post.categories.length > 0) {
                md += `**Categorie:** ${post.categories.join(', ')}\n`;
            }
            
            if (post.tags.length > 0) {
                md += `**Tag:** ${post.tags.join(', ')}\n`;
            }
            
            if (post.link) {
                md += `**Link:** ${post.link}\n`;
            }
            
            md += `\n`;
            
            // Excerpt
            if (post.excerpt) {
                const excerptMd = htmlToMarkdown(post.excerpt);
                if (excerptMd) {
                    md += `### Riassunto\n\n`;
                    md += `> ${excerptMd.replace(/\n/g, '\n> ')}\n\n`;
                }
            }
            
            // Content
            if (post.content) {
                md += `### Contenuto\n\n`;
                md += htmlToMarkdown(post.content) + `\n\n`;
            }
            
            md += `---\n\n`;
        });
    }
    
    // Pages
    if (data.pages.length > 0) {
        md += `# PAGINE\n\n`;
        
        data.pages.forEach((page, index) => {
            md += `## ${index + 1}. ${page.title || 'Senza titolo'}\n\n`;
            
            // Metadata
            md += `**Autore:** ${page.creator || 'N/A'}\n`;
            md += `**Data:** ${formatDate(page.postDate)}\n`;
            md += `**Stato:** ${translateStatus(page.status)}\n`;
            
            if (page.link) {
                md += `**Link:** ${page.link}\n`;
            }
            
            md += `\n`;
            
            // Content
            if (page.content) {
                md += `### Contenuto\n\n`;
                md += htmlToMarkdown(page.content) + `\n\n`;
            }
            
            md += `---\n\n`;
        });
    }
    
    // Footer
    md += `\n---\n\n`;
    md += `*Documento generato da WordPress XML to Markdown Converter*\n`;
    md += `*Data generazione: ${new Date().toLocaleDateString('it-IT')}*\n`;
    
    return md;
}

function translateStatus(status) {
    const statusMap = {
        'publish': 'Pubblicato',
        'draft': 'Bozza',
        'pending': 'In attesa',
        'private': 'Privato',
        'future': 'Programmato',
        'trash': 'Cestinato'
    };
    return statusMap[status] || status;
}

// ========================================
// UI Functions
// ========================================
function updateStats(data) {
    postCount.textContent = data.posts.length;
    pageCount.textContent = data.pages.length;
    categoryCount.textContent = data.categories.length;
    tagCount.textContent = data.tags.length;
}

function showLoading() {
    statsSection.hidden = true;
    previewSection.hidden = true;
    errorSection.hidden = true;
    loadingSection.hidden = false;
}

function showPreview(markdown) {
    loadingSection.hidden = true;
    errorSection.hidden = true;
    statsSection.hidden = false;
    previewSection.hidden = false;
    previewText.textContent = markdown;
}

function showError(message) {
    loadingSection.hidden = true;
    statsSection.hidden = true;
    previewSection.hidden = true;
    errorSection.hidden = false;
    errorMessage.textContent = message;
}

function resetUpload() {
    currentFile = null;
    markdownContent = '';
    parsedData = null;
    
    fileInput.value = '';
    dropZone.hidden = false;
    fileInfo.hidden = true;
    statsSection.hidden = true;
    previewSection.hidden = true;
    loadingSection.hidden = true;
    errorSection.hidden = true;
}

// ========================================
// Actions
// ========================================
async function copyToClipboard() {
    try {
        await navigator.clipboard.writeText(markdownContent);
        showToast('Copiato negli appunti!');
    } catch (err) {
        // Fallback for older browsers
        const textarea = document.createElement('textarea');
        textarea.value = markdownContent;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showToast('Copiato negli appunti!');
    }
}

function downloadMarkdown() {
    if (!markdownContent) return;
    
    const blob = new Blob([markdownContent], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    
    // Generate filename from site title or original file
    let downloadName = 'wordpress-export';
    if (parsedData && parsedData.siteInfo.title) {
        downloadName = parsedData.siteInfo.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
    } else if (currentFile) {
        downloadName = currentFile.name.replace('.xml', '');
    }
    
    a.href = url;
    a.download = `${downloadName}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showToast('Download avviato!');
}

function showToast(message) {
    toastMessage.textContent = message;
    toast.hidden = false;
    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            toast.hidden = true;
        }, 250);
    }, 2500);
}
