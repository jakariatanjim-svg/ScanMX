import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  ButtonBase,
  Chip,
  CircularProgress,
  CssBaseline,
  Divider,
  FormControlLabel,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  Slider,
  Snackbar,
  Switch,
  ThemeProvider,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  createTheme,
} from '@mui/material';
import AddRounded from '@mui/icons-material/AddRounded';
import AutoFixHighRounded from '@mui/icons-material/AutoFixHighRounded';
import AutoAwesomeRounded from '@mui/icons-material/AutoAwesomeRounded';
import CameraAltRounded from '@mui/icons-material/CameraAltRounded';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import CloudOffRounded from '@mui/icons-material/CloudOffRounded';
import ContentPasteGoRounded from '@mui/icons-material/ContentPasteGoRounded';
import CropFreeRounded from '@mui/icons-material/CropFreeRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import DescriptionRounded from '@mui/icons-material/DescriptionRounded';
import FilterBAndWRounded from '@mui/icons-material/FilterBAndWRounded';
import FilterDramaRounded from '@mui/icons-material/FilterDramaRounded';
import ImageRounded from '@mui/icons-material/ImageRounded';
import LockRounded from '@mui/icons-material/LockRounded';
import MoreHorizRounded from '@mui/icons-material/MoreHorizRounded';
import PictureAsPdfRounded from '@mui/icons-material/PictureAsPdfRounded';
import RotateRightRounded from '@mui/icons-material/RotateRightRounded';
import ShieldRounded from '@mui/icons-material/ShieldRounded';
import TuneRounded from '@mui/icons-material/TuneRounded';
import UploadFileRounded from '@mui/icons-material/UploadFileRounded';
import { canvasToBlob, detectPage, getOpenCv, loadImage, processScan } from './scanEngine';
import { createPdfBlob } from './pdf';
import { isValidQuad } from './geometry.js';
import './styles.css';

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#c9f36e', contrastText: '#141811' },
    secondary: { main: '#9b8aff' },
    background: { default: '#101210', paper: '#191c19' },
    text: { primary: '#f2f4ed', secondary: '#a0a69d' },
    success: { main: '#9be77f' },
    warning: { main: '#ffc96b' },
  },
  shape: { borderRadius: 14 },
  typography: {
    fontFamily: 'Inter, "Hind Siliguri", "Noto Sans Bengali Variable", "Nirmala UI", system-ui, sans-serif',
    button: { textTransform: 'none', fontWeight: 650 },
  },
  components: {
    MuiButton: { styleOverrides: { root: { borderRadius: 12, minHeight: 42, paddingInline: 17, boxShadow: 'none' } } },
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
    MuiTooltip: { styleOverrides: { tooltip: { background: '#252923', border: '1px solid #363b34', fontSize: '0.76rem' } } },
    MuiSlider: { styleOverrides: { root: { color: '#c9f36e' }, thumb: { boxShadow: '0 0 0 5px rgba(201,243,110,.12)' } } },
  },
});

const translations = {
  en: {
    studio: 'DOCUMENT STUDIO', local: 'Processed on your device', engineLoading: 'Starting scan engine', engineReady: 'Offline scanner ready',
    heroEyebrow: 'PRIVATE, BROWSER-BASED DOCUMENT SCANNER', heroA: 'Professional scans.', heroB: 'Entirely private.',
    heroBody: 'Turn photos into clean, aligned documents. Automatic edge detection, fold and shadow correction, and high-quality PDF export, all processed on your device.',
    noAccount: 'No account required', noUploads: 'No uploads', noPageCap: 'Unlimited pages', processedHere: 'Processed on this device',
    threeSteps: 'HOW IT WORKS', makeScanReady: 'Enhance your document', pageShape: 'Page edges', dragHandles: 'Drag each corner to match the page edges', localEngine: 'LOCAL SCAN ENGINE',
    dropTitle: 'Add your documents', dropBody: 'Drag images here or select files from your device', choose: 'Choose images', camera: 'Use camera',
    fileHint: 'JPG · PNG · WEBP', pasteHint: 'Paste an image with', pasteEnd: '',
    privacyTitle: 'Private by design', privacyBody: 'ScanMX runs entirely in this browser tab. Your photos are never uploaded.',
    localChip: 'PRIVATE BY DEFAULT', howTitle: 'A complete document workflow', howBody: 'Capture, refine and export documents without an account or an upload.',
    stepOne: 'Add a page', stepOneBody: 'Drop, browse, use your camera or paste a screenshot.', stepTwo: 'Enhance your document', stepTwoBody: 'Detect page edges, correct perspective and remove fold shadows automatically.', stepThree: 'Save and share', stepThreeBody: 'Export a multi-page PDF or a high-resolution PNG.',
    footer: 'Private document scanning on your own device.',
    workspace: 'DOCUMENT WORKSPACE', addPages: 'Add pages', page: 'PAGE', pages: 'PAGES',
    scanPreview: 'Scan preview', editCorners: 'Adjust corners', finishCorners: 'Apply crop',
    findingEdges: 'Finding page edges…', updating: 'Updating scan preview…', detected: 'Page edges found', notDetected: 'Adjust corners manually',
    autoDetect: 'Auto-adjust corners', resetCrop: 'Use full photo', rotate: 'Rotate 90°',
    enhancement: 'ENHANCEMENT', smartName: 'Smart clean', smartDesc: 'Removes fold shadows, uneven light and paper tint for a clean white page.', colorName: 'Color', colorDesc: 'Keeps natural color with balanced contrast.', grayName: 'Grayscale', grayDesc: 'Neutral grayscale with clear detail.', bwName: 'Black & white', bwDesc: 'High-contrast black text on white.',
    paperCleanup: 'Cleanup strength', exposure: 'Exposure', softer: 'Soft', stronger: 'Strong', darker: 'Darker', brighter: 'Brighter',
    savePdf: 'Export PDF', saveImage: 'Save this page as PNG', exporting: 'Preparing PDF…',
    privateNote: 'Documents stay on this device', localNote: 'Processed locally · no account · no upload',
    dropMore: 'Add more pages to this document', emptyTitle: 'No documents added', removePage: 'Remove page',
    scanEngineError: 'The offline scan engine could not start in this browser.', openGuide: 'How it works', pasteToast: 'Screenshot pasted from clipboard.',
    addedToast: 'page(s) added to your scan.', imageOnly: 'Choose JPG, PNG, WEBP or another image file.',
    failedExport: 'The file could not be created. Please try again.', failedImport: 'One or more images could not be opened.',
    smartNote: 'Corrects fold shadows, uneven lighting and paper tint automatically. Severe creases, glare or blur may still need a new photo.', dropRelease: 'Release to add documents', originalAlt: 'Original photo with adjustable document corners', previewAlt: 'Processed document preview', moreExport: 'More export options', smartBadge: 'SMART CLEAN', perspectiveLabel: 'Perspective correction',
    pageFallback: 'Page', loading: 'Opening your document…',
    linesTitle: 'Ruled lines', keepLines: 'Keep lines', textOnly: 'Text only', straightenLabel: 'Straighten curved text',
  },
  bn: {
    studio: 'ডকুমেন্ট স্টুডিও', local: 'সম্পূর্ণ আপনার ডিভাইসে', engineLoading: 'স্ক্যানার প্রস্তুত হচ্ছে', engineReady: 'অফলাইন স্ক্যানার প্রস্তুত',
    heroEyebrow: 'ব্যক্তিগত, ব্রাউজারভিত্তিক ডকুমেন্ট স্ক্যানার', heroA: 'মানসম্মত স্ক্যান।', heroB: 'সম্পূর্ণ ব্যক্তিগত।',
    heroBody: 'সাধারণ ছবিকে পরিষ্কার, সোজা ডকুমেন্টে রূপ দিন। স্বয়ংক্রিয় কিনারা শনাক্তকরণ, ভাঁজের ছায়া সংশোধন ও উচ্চমানের PDF এক্সপোর্ট—সবই এই ডিভাইসে।',
    noAccount: 'অ্যাকাউন্ট লাগে না', noUploads: 'কোনো আপলোড নেই', noPageCap: 'পাতার সীমা নেই', processedHere: 'এই ডিভাইসেই প্রসেস হয়',
    threeSteps: 'কীভাবে কাজ করে', makeScanReady: 'ডকুমেন্ট উন্নত করুন', pageShape: 'পাতার কিনারা', dragHandles: 'কোণাগুলো টেনে পাতার কিনারার সঙ্গে মেলান', localEngine: 'অফলাইন স্ক্যান ইঞ্জিন',
    dropTitle: 'এখানে ছবি ছেড়ে দিন', dropBody: 'অথবা ডিভাইস থেকে ছবি বেছে নিন', choose: 'ছবি বাছাই করুন', camera: 'ক্যামেরা খুলুন',
    fileHint: 'JPG · PNG · WEBP', pasteHint: 'স্ক্রিনশট পেস্ট করতে চাপুন', pasteEnd: '',
    privacyTitle: 'আপনার ছবি আপনার কাছেই', privacyBody: 'ScanMX সম্পূর্ণভাবে এই ব্রাউজার ট্যাবে কাজ করে। আপনার ছবি কখনো আপলোড হয় না।',
    localChip: 'শুরু থেকেই ব্যক্তিগত', howTitle: 'ছবি থেকে প্রস্তুত স্ক্যান', howBody: 'প্রথম পাতা থেকে PDF—সহজ, সম্পূর্ণ লোকাল একটি কাজের ধারা।',
    stepOne: 'পাতা যোগ করুন', stepOneBody: 'ছবি টেনে আনুন, বাছাই করুন, ক্যামেরা ব্যবহার করুন বা স্ক্রিনশট পেস্ট করুন।', stepTwo: 'স্ক্যানের মতো করুন', stepTwoBody: 'পাতার কিনারা শনাক্ত করুন, দৃষ্টিকোণ ঠিক করুন ও ভাঁজের ছায়া স্বয়ংক্রিয়ভাবে সরান।', stepThree: 'সেভ ও শেয়ার করুন', stepThreeBody: 'পরিষ্কার PDF ডাউনলোড করুন, অথবা পাতাটি ছবি হিসেবে সেভ করুন।',
    footer: 'আপনার নিজের ডিভাইসে ব্যক্তিগত ডকুমেন্ট স্ক্যানিং।',
    workspace: 'ডকুমেন্ট ওয়ার্কস্পেস', addPages: 'পাতা যোগ', page: 'পাতা', pages: 'পাতা',
    scanPreview: 'স্ক্যান প্রিভিউ', editCorners: 'কোণা ঠিক করুন', finishCorners: 'সম্পন্ন',
    findingEdges: 'পাতার সীমানা খোঁজা হচ্ছে…', updating: 'স্ক্যান প্রিভিউ আপডেট হচ্ছে…', detected: 'পাতার সীমানা পাওয়া গেছে', notDetected: 'কোণা নিজে ঠিক করুন',
    autoDetect: 'কোণা স্বয়ংক্রিয়ভাবে ঠিক করুন', resetCrop: 'পুরো ছবি ব্যবহার', rotate: '৯০° ঘোরান',
    enhancement: 'এনহ্যান্সমেন্ট', smartName: 'স্মার্ট ক্লিন', smartDesc: 'ভাঁজের ছায়া, অসম আলো ও কাগজের রং সরিয়ে পরিষ্কার সাদা পাতা তৈরি করে।', colorName: 'রঙিন', colorDesc: 'স্বাভাবিক কালি ও রং বজায় রাখে।', grayName: 'গ্রেস্কেল', grayDesc: 'রং ছাড়া স্পষ্ট ডিটেইল রাখে।', bwName: 'সাদা-কালো', bwDesc: 'স্পষ্ট, উচ্চ-কনট্রাস্ট সাদা-কালো স্ক্যান।',
    paperCleanup: 'পরিষ্কারের মাত্রা', exposure: 'আলো', softer: 'কম', stronger: 'বেশি', darker: 'গাঢ়', brighter: 'উজ্জ্বল',
    savePdf: 'PDF এক্সপোর্ট', saveImage: 'পাতাটি PNG হিসেবে সেভ', exporting: 'PDF তৈরি হচ্ছে…',
    privateNote: 'এই ট্যাবের বাইরে কিছু যায় না', localNote: 'ডিভাইসেই প্রসেস · অ্যাকাউন্ট নেই · আপলোড নেই',
    dropMore: 'এই ডকুমেন্টে আরও পাতা যোগ করুন', emptyTitle: 'এখনও কোনো পাতা নেই', removePage: 'পাতা সরান',
    scanEngineError: 'এই ব্রাউজারে অফলাইন স্ক্যানার চালু করা যায়নি।', openGuide: 'ব্যবহারবিধি', pasteToast: 'ক্লিপবোর্ড থেকে স্ক্রিনশট পেস্ট হয়েছে।',
    addedToast: 'টি পাতা স্ক্যানে যোগ হয়েছে।', imageOnly: 'JPG, PNG, WEBP বা অন্য কোনো ছবি বেছে নিন।',
    failedExport: 'ফাইল তৈরি করা যায়নি। আবার চেষ্টা করুন।', failedImport: 'এক বা একাধিক ছবি খোলা যায়নি।',
    smartNote: 'ভাঁজের ছায়া, অসম আলো ও কাগজের রং স্বয়ংক্রিয়ভাবে ঠিক হয়। খুব গভীর ভাঁজ, আলোর ঝলক বা ঝাপসা ছবির জন্য নতুন ছবি প্রয়োজন হতে পারে।', dropRelease: 'ডকুমেন্ট যোগ করতে ছেড়ে দিন', originalAlt: 'কোণা সমন্বয়ের জন্য মূল ছবি', previewAlt: 'প্রসেস করা ডকুমেন্টের প্রিভিউ', moreExport: 'এক্সপোর্টের আরও বিকল্প', smartBadge: 'স্বয়ংক্রিয় এনহ্যান্সমেন্ট', perspectiveLabel: 'পার্সপেক্টিভ সংশোধন',
    pageFallback: 'পাতা', loading: 'ছবি লোড হচ্ছে…',
    linesTitle: 'খাতার লাইন', keepLines: 'লাইন রাখুন', textOnly: 'শুধু লেখা', straightenLabel: 'বাঁকা লেখা সোজা করুন',
  },
};

const presetOptions = [
  { id: 'smart', labelKey: 'smartName', descriptionKey: 'smartDesc', Icon: AutoFixHighRounded },
  { id: 'color', labelKey: 'colorName', descriptionKey: 'colorDesc', Icon: FilterDramaRounded },
  { id: 'gray', labelKey: 'grayName', descriptionKey: 'grayDesc', Icon: TuneRounded },
  { id: 'bw', labelKey: 'bwName', descriptionKey: 'bwDesc', Icon: FilterBAndWRounded },
];

function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 48 48" role="img" aria-label="ScanMX">
      <defs>
        <linearGradient id="brandGlow" x1="6" y1="4" x2="42" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#E4FF9A" />
          <stop offset="1" stopColor="#A7DF5A" />
        </linearGradient>
      </defs>
      <rect x="3" y="3" width="42" height="42" rx="14" fill="#20271B" stroke="#425039" />
      <path d="M16 13.5h11.5L33 19v15.5H16a2 2 0 0 1-2-2v-17a2 2 0 0 1 2-2Z" fill="url(#brandGlow)" />
      <path d="M27.5 13.5V19H33" fill="none" stroke="#536540" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M18.5 24h12M18.5 28h9" stroke="#566A42" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M9.5 18v-3.5A2.5 2.5 0 0 1 12 12h2M38.5 30v3.5A2.5 2.5 0 0 1 36 36h-2" fill="none" stroke="#E4FF9A" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function readSavedLanguage() {
  try {
    return localStorage.getItem('scanmx-language') === 'bn' ? 'bn' : 'en';
  } catch {
    return 'en';
  }
}

function getFullFrame(width, height) {
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
}

function releaseImage(image) {
  if (!image) return;
  image.onload = null;
  image.onerror = null;
  image.removeAttribute?.('src');
}

async function withLoadedImage(url, task) {
  const image = await loadImage(url);
  try {
    return await task(image);
  } finally {
    releaseImage(image);
  }
}

function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function dateStamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function ImageStage({ page, cropMode, onCornersChange, labels }) {
  const stageRef = useRef(null);
  const svgRef = useRef(null);
  const dragIndex = useRef(null);
  const [frame, setFrame] = useState({ left: 0, top: 0, width: 0, height: 0, scale: 1 });
  const visibleUrl = cropMode ? page.url : (page.previewUrl || page.url);
  const visibleWidth = cropMode ? page.width : (page.previewWidth || page.width);
  const visibleHeight = cropMode ? page.height : (page.previewHeight || page.height);

  useEffect(() => {
    const element = stageRef.current;
    if (!element || !visibleWidth || !visibleHeight) return undefined;
    const updateFrame = () => {
      const bounds = element.getBoundingClientRect();
      const roomWidth = Math.max(100, bounds.width - 70);
      const roomHeight = Math.max(100, bounds.height - 72);
      const scale = Math.min(roomWidth / visibleWidth, roomHeight / visibleHeight);
      const width = visibleWidth * scale;
      const height = visibleHeight * scale;
      setFrame({ left: (bounds.width - width) / 2, top: (bounds.height - height) / 2, width, height, scale });
    };
    const observer = new ResizeObserver(updateFrame);
    observer.observe(element);
    updateFrame();
    return () => observer.disconnect();
  }, [visibleWidth, visibleHeight]);

  const svgPoint = (event) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(svg.getScreenCTM().inverse());
  };

  const startDrag = (event) => {
    if (!cropMode) return;
    const handle = event.target.closest('[data-corner]');
    if (!handle) return;
    const index = Number(handle.getAttribute('data-corner'));
    if (!Number.isInteger(index) || index < 0 || index > 3) return;
    event.preventDefault();
    dragIndex.current = index;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event) => {
    if (dragIndex.current === null) return;
    const point = svgPoint(event);
    if (!point) return;
    const next = page.corners.map((corner) => ({ ...corner }));
    next[dragIndex.current] = {
      x: Math.max(0, Math.min(page.width, point.x)),
      y: Math.max(0, Math.min(page.height, point.y)),
    };
    if (isValidQuad(next)) onCornersChange(next);
  };

  const endDrag = (event) => {
    dragIndex.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const handleRadius = frame.scale ? Math.max(9, Math.min(96, 13 / frame.scale)) : 20;
  const cornerString = cropMode ? page.corners.map((point) => `${point.x},${point.y}`).join(' ') : '';
  return (
    <div className={`preview-stage ${cropMode ? 'preview-stage-editing' : ''}`} ref={stageRef}>
      {!visibleWidth || !visibleHeight ? (
        <div className="stage-empty"><CircularProgress size={22} /><span>{labels.loading}</span></div>
      ) : (
        <div className="preview-frame" style={{ left: frame.left, top: frame.top, width: frame.width, height: frame.height }}>
          <img src={visibleUrl} alt={cropMode ? labels.originalAlt : labels.previewAlt} draggable="false" />
          {cropMode && (
            <svg
              ref={svgRef}
              className="crop-overlay"
              viewBox={`0 0 ${page.width} ${page.height}`}
              preserveAspectRatio="none"
              onPointerDown={startDrag}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              <polygon points={cornerString} className="crop-area" />
              <polyline points={`${cornerString} ${page.corners[0].x},${page.corners[0].y}`} className="crop-outline" />
              {page.corners.map((corner, index) => (
                <g key={index} className="crop-handle" data-corner={index}>
                  <circle cx={corner.x} cy={corner.y} r={handleRadius * 1.5} className="crop-handle-halo" data-corner={index} />
                  <circle cx={corner.x} cy={corner.y} r={handleRadius * 0.56} className="crop-handle-core" data-corner={index} />
                </g>
              ))}
            </svg>
          )}
        </div>
      )}
      {!cropMode && page.isProcessing && page.previewUrl && (
        <div className="preview-updating"><CircularProgress size={15} /><span>{labels.updating}</span></div>
      )}
      {cropMode && <div className="stage-instruction"><CropFreeRounded fontSize="small" />{labels.dragHandles}</div>}
    </div>
  );
}

function EmptyState({ copy, engineStatus, onChoose, onCamera, dropActive }) {
  return (
    <>
      <section className="hero-grid">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-dot" />{copy.heroEyebrow}</div>
          <Typography component="h1" className="hero-title">
            {copy.heroA}<br /><span>{copy.heroB}</span>
          </Typography>
          <Typography className="hero-description">{copy.heroBody}</Typography>
          <div className="hero-proof-row">
            <span><CheckCircleRounded />{copy.noAccount}</span>
            <span><CheckCircleRounded />{copy.noUploads}</span>
            <span><CheckCircleRounded />{copy.noPageCap}</span>
          </div>
          <div className="visual-card" aria-hidden="true">
            <div className="visual-orbit visual-orbit-one" />
            <div className="visual-orbit visual-orbit-two" />
            <div className="scan-beam" />
            <div className="scan-paper">
              <div className="paper-corner paper-tl" /><div className="paper-corner paper-tr" />
              <div className="paper-corner paper-bl" /><div className="paper-corner paper-br" />
              <div className="paper-mini-title" />
              <div className="paper-row paper-row-wide" /><div className="paper-row" /><div className="paper-row paper-row-short" />
              <div className="paper-mini-heading" />
              <div className="paper-row paper-row-wide" /><div className="paper-row paper-row-short" />
              <div className="paper-stamp">MX</div>
            </div>
            <div className="visual-label"><AutoAwesomeRounded />{copy.smartBadge}</div>
            <div className="visual-caption"><span /> {copy.perspectiveLabel} <CheckCircleRounded /></div>
          </div>
        </div>

        <div className="upload-column">
          <Paper
            elevation={0}
            className={`drop-card ${dropActive ? 'drop-card-active' : ''}`}
            onClick={onChoose}
          >
            <div className="drop-card-top"><span className="upload-mark"><UploadFileRounded /></span><Chip size="small" icon={<LockRounded />} label={copy.localChip} className="privacy-chip" /></div>
            <Typography component="h2" className="drop-title">{copy.dropTitle}</Typography>
            <Typography className="drop-description">{copy.dropBody}</Typography>
            <div className="drop-action-row">
              <Button variant="contained" onClick={(event) => { event.stopPropagation(); onChoose(); }} startIcon={<ImageRounded />}>
                {copy.choose}
              </Button>
              <Button variant="outlined" onClick={(event) => { event.stopPropagation(); onCamera(); }} startIcon={<CameraAltRounded />}>
                {copy.camera}
              </Button>
            </div>
            <div className="file-types"><span>{copy.fileHint}</span><span className="file-type-dot" /><span>{copy.processedHere}</span></div>
            <div className="paste-callout"><ContentPasteGoRounded /><span>{copy.pasteHint} <kbd>Ctrl</kbd><b>+</b><kbd>V</kbd> {copy.pasteEnd}</span></div>
            {dropActive && <div className="drop-active-note"><UploadFileRounded />{copy.dropRelease}</div>}
          </Paper>
          <Paper elevation={0} className="privacy-card">
            <div className="privacy-icon"><ShieldRounded /></div>
            <div><Typography className="privacy-card-title">{copy.privacyTitle}</Typography><Typography className="privacy-card-body">{copy.privacyBody}</Typography></div>
            <LockRounded className="privacy-lock" />
          </Paper>
          <div className={`engine-line ${engineStatus === 'error' ? 'engine-line-error' : ''}`}>
            <span className="engine-pulse" />
            {engineStatus === 'ready' ? copy.engineReady : engineStatus === 'error' ? copy.scanEngineError : copy.engineLoading}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="how-section">
        <div className="section-title-row">
          <div><span className="section-kicker">{copy.threeSteps}</span><Typography component="h2">{copy.howTitle}</Typography></div>
          <Typography>{copy.howBody}</Typography>
        </div>
        <div className="steps-grid">
          {[
            { number: '01', icon: UploadFileRounded, title: copy.stepOne, body: copy.stepOneBody },
            { number: '02', icon: AutoFixHighRounded, title: copy.stepTwo, body: copy.stepTwoBody },
            { number: '03', icon: PictureAsPdfRounded, title: copy.stepThree, body: copy.stepThreeBody },
          ].map(({ number, icon: Icon, title, body }) => (
            <Paper elevation={0} className="step-card" key={number}>
              <div className="step-card-top"><span>{number}</span><Icon /></div>
              <Typography component="h3">{title}</Typography><Typography>{body}</Typography>
            </Paper>
          ))}
        </div>
      </section>
    </>
  );
}

function App() {
  const [language, setLanguage] = useState(readSavedLanguage);
  const copy = translations[language];
  const [pages, setPages] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [engineStatus, setEngineStatus] = useState('loading');
  const [engineError, setEngineError] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [cropMode, setCropMode] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const objectUrlsRef = useRef(new Set());
  const activePage = useMemo(() => pages.find((page) => page.id === activeId) || null, [pages, activeId]);
  const activeIndex = pages.findIndex((page) => page.id === activeId);

  useEffect(() => {
    let cancelled = false;
    getOpenCv()
      .then(() => { if (!cancelled) setEngineStatus('ready'); })
      .catch((error) => {
        if (!cancelled) {
          setEngineStatus('error');
          setEngineError(error?.message || copy.scanEngineError);
        }
      });
    return () => { cancelled = true; };
    // Copy is intentionally not a dependency; the engine only starts once per page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const notify = useCallback((message, severity = 'info') => {
    setSnackbar({ open: true, message, severity });
  }, []);

  const handleFiles = useCallback(async (fileList) => {
    const incoming = Array.from(fileList || []).filter((file) => file && (file.type.startsWith('image/') || /\.(jpe?g|png|webp|bmp|gif|tiff?)$/i.test(file.name)));
    if (!incoming.length) {
      if (fileList?.length) notify(copy.imageOnly, 'warning');
      return;
    }
    const records = [];
    let firstPageId = null;
    for (const file of incoming) {
      const url = URL.createObjectURL(file);
      objectUrlsRef.current.add(url);
      try {
        const image = await loadImage(url);
        const width = image.naturalWidth;
        const height = image.naturalHeight;
        releaseImage(image);
        const id = globalThis.crypto?.randomUUID?.() || `page-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const record = {
          id, file, url, name: file.name || `ScanMX-${Date.now()}.png`, width, height,
          corners: getFullFrame(width, height),
          detected: false, detectionAttempted: false, confidence: 0,
          mode: 'smart', rotation: 0, settings: { cleanup: 80, exposure: 0, keepLines: true, straighten: true },
          editVersion: 0, previewVersion: -1, previewUrl: null, previewWidth: 0, previewHeight: 0,
          isProcessing: true, processError: '',
        };
        records.push(record);
        setPages((previous) => [...previous, record]);
        if (!firstPageId) {
          firstPageId = id;
          setActiveId(id);
          setCropMode(false);
        }
      } catch (error) {
        URL.revokeObjectURL(url);
        objectUrlsRef.current.delete(url);
      }
    }
    if (!records.length) {
      notify(copy.failedImport, 'error');
      return;
    }
    if (records.length !== incoming.length) notify(copy.failedImport, 'warning');
    else if (incoming.length > 1) notify(`${incoming.length} ${copy.addedToast}`, 'success');
  }, [notify, copy]);

  useEffect(() => {
    const onPaste = (event) => {
      const clipboardItems = Array.from(event.clipboardData?.items || []);
      const images = clipboardItems.map((item) => item.kind === 'file' ? item.getAsFile() : null).filter((file) => file?.type.startsWith('image/'));
      if (images.length) {
        event.preventDefault();
        handleFiles(images);
        notify(copy.pasteToast, 'success');
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [handleFiles, notify, copy]);

  useEffect(() => {
    if (!activePage || engineStatus !== 'ready') return undefined;
    if (activePage.previewUrl && activePage.previewVersion === activePage.editVersion) return undefined;
    let cancelled = false;
    const id = activePage.id;
    const targetVersion = activePage.editVersion;
    const task = async () => {
      setPages((previous) => previous.map((page) => page.id === id ? { ...page, isProcessing: true, processError: '' } : page));
      let image = null;
      try {
        image = await loadImage(activePage.url);
        if (!activePage.detectionAttempted) {
          const cv = await getOpenCv();
          const result = detectPage(image, cv);
          releaseImage(image);
          image = null;
          if (cancelled) return;
          setPages((previous) => previous.map((page) => page.id === id && page.editVersion === targetVersion
            ? { ...page, corners: result.corners, detected: result.detected, confidence: result.confidence, detectionAttempted: true, editVersion: page.editVersion + 1, isProcessing: false }
            : page));
          return;
        }
        const cv = await getOpenCv();
        const result = processScan(image, activePage.corners, {
          mode: activePage.mode,
          rotation: activePage.rotation,
          settings: activePage.settings,
          maxEdge: 1700,
        }, cv);
        releaseImage(image);
        image = null;
        const blob = await canvasToBlob(result.canvas, 'image/jpeg', 0.9);
        const previewUrl = URL.createObjectURL(blob);
        objectUrlsRef.current.add(previewUrl);
        if (cancelled) {
          URL.revokeObjectURL(previewUrl);
          objectUrlsRef.current.delete(previewUrl);
          return;
        }
        setPages((previous) => previous.map((page) => {
          if (page.id !== id || page.editVersion !== targetVersion) return page;
          if (page.previewUrl && page.previewUrl !== previewUrl) window.setTimeout(() => {
            URL.revokeObjectURL(page.previewUrl);
            objectUrlsRef.current.delete(page.previewUrl);
          }, 0);
          return { ...page, previewUrl, previewWidth: result.width, previewHeight: result.height, previewVersion: targetVersion, isProcessing: false, processError: '' };
        }));
      } catch (error) {
        releaseImage(image);
        if (cancelled) return;
        setPages((previous) => previous.map((page) => page.id === id && page.editVersion === targetVersion
          ? { ...page, isProcessing: false, processError: error?.message || 'Could not process this image.' }
          : page));
      }
    };
    const timer = window.setTimeout(task, activePage.detectionAttempted ? 140 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activePage?.id, activePage?.editVersion, engineStatus]);

  useEffect(() => {
    document.documentElement.lang = language;
    try { localStorage.setItem('scanmx-language', language); } catch { /* local file mode may block storage */ }
  }, [language]);

  useEffect(() => () => {
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current.clear();
  }, []);

  const updateActive = useCallback((patch) => {
    if (!activeId) return;
    setPages((previous) => previous.map((page) => page.id === activeId
      ? { ...page, ...patch, editVersion: page.editVersion + 1 }
      : page));
  }, [activeId]);

  const onImageInput = (event) => {
    handleFiles(event.target.files);
    event.target.value = '';
  };

  const removePage = (id) => {
    const removedIndex = pages.findIndex((page) => page.id === id);
    const removed = pages[removedIndex];
    if (!removed) return;
    URL.revokeObjectURL(removed.url);
    objectUrlsRef.current.delete(removed.url);
    if (removed.previewUrl) {
      URL.revokeObjectURL(removed.previewUrl);
      objectUrlsRef.current.delete(removed.previewUrl);
    }
    setPages((previous) => previous.filter((page) => page.id !== id));
    if (activeId === id) {
      const next = pages[removedIndex + 1] || pages[removedIndex - 1];
      setActiveId(next?.id || null);
      setCropMode(false);
    }
  };

  const runAutoDetect = async () => {
    if (!activePage || engineStatus !== 'ready') return;
    try {
      const result = await withLoadedImage(activePage.url, async (image) => {
        const cv = await getOpenCv();
        return detectPage(image, cv);
      });
      updateActive({ corners: result.corners, detected: result.detected, confidence: result.confidence, detectionAttempted: true, processError: '' });
      setCropMode(true);
      notify(result.detected ? copy.detected : copy.notDetected, result.detected ? 'success' : 'info');
    } catch (error) {
      notify(error?.message || copy.failedImport, 'error');
    }
  };

  const exportPdf = async () => {
    if (!pages.length || exporting) return;
    setExporting(true);
    setMenuAnchor(null);
    try {
      const cv = await getOpenCv();
      const outputPages = [];
      for (const page of pages) {
        const resultPage = await withLoadedImage(page.url, async (image) => {
          const corners = page.detectionAttempted ? page.corners : detectPage(image, cv).corners;
          const result = processScan(image, corners, {
            mode: page.mode,
            rotation: page.rotation,
            settings: page.settings,
            maxEdge: 3000,
          }, cv);
          const blob = await canvasToBlob(result.canvas, 'image/jpeg', 0.94);
          return { blob, width: result.width, height: result.height };
        });
        outputPages.push(resultPage);
      }
      const pdf = await createPdfBlob(outputPages);
      downloadBlob(pdf, `ScanMX-${dateStamp()}.pdf`);
      notify(copy.savePdf, 'success');
    } catch (error) {
      console.error('ScanMX PDF export failed', error);
      notify(error?.message || copy.failedExport, 'error');
    } finally {
      setExporting(false);
    }
  };

  const exportCurrentImage = async () => {
    if (!activePage || exporting) return;
    setExporting(true);
    setMenuAnchor(null);
    try {
      const cv = await getOpenCv();
      const blob = await withLoadedImage(activePage.url, async (image) => {
        const corners = activePage.detectionAttempted ? activePage.corners : detectPage(image, cv).corners;
        const result = processScan(image, corners, {
          mode: activePage.mode,
          rotation: activePage.rotation,
          settings: activePage.settings,
          maxEdge: 3000,
        }, cv);
        return canvasToBlob(result.canvas, 'image/png');
      });
      downloadBlob(blob, `ScanMX-${dateStamp()}-page-${activeIndex + 1}.png`);
      notify(copy.saveImage, 'success');
    } catch (error) {
      console.error('ScanMX image export failed', error);
      notify(error?.message || copy.failedExport, 'error');
    } finally {
      setExporting(false);
    }
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setDragActive(false);
    handleFiles(event.dataTransfer.files);
  };

  return (
    <ThemeProvider theme={theme}>
      <div
        className={`app-shell ${language === 'bn' ? 'app-bengali' : ''}`}
        onDragOver={(event) => { if (Array.from(event.dataTransfer?.types || []).includes('Files')) { event.preventDefault(); setDragActive(true); } }}
        onDragLeave={(event) => { if (!event.relatedTarget) setDragActive(false); }}
        onDrop={handleDrop}
      >
        <CssBaseline />
        <input ref={fileInputRef} type="file" accept="image/*" multiple className="visually-hidden" onChange={onImageInput} />
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="visually-hidden" onChange={onImageInput} />
        <header className="topbar">
          <a className="brand" href="#top" aria-label="ScanMX home"><BrandMark /><span className="brand-name">ScanMX</span><span className="brand-divider" /><span className="brand-caption">{copy.studio}</span></a>
          <div className="topbar-actions">
            <div className="local-indicator"><span className="local-indicator-dot" /><LockRounded /><span>{copy.local}</span></div>
            <Button className="language-button" onClick={() => setLanguage((current) => current === 'bn' ? 'en' : 'bn')} aria-label="Switch language">
              {language === 'bn' ? 'EN' : 'বাংলা'}
            </Button>
            {!pages.length ? <Button className="guide-button" href="#how-it-works" endIcon={<ChevronRightRounded />}>{copy.openGuide}</Button> : (
              <Button className="top-add-button" variant="contained" startIcon={<AddRounded />} onClick={() => fileInputRef.current?.click()}>{copy.addPages}</Button>
            )}
          </div>
        </header>

        <main id="top" className="main-content">
          {!pages.length ? (
            <EmptyState
              copy={copy}
              engineStatus={engineStatus}
              onChoose={() => fileInputRef.current?.click()}
              onCamera={() => cameraInputRef.current?.click()}
              dropActive={dragActive}
            />
          ) : (
            <>
              <div className="workspace-heading">
                <div><span className="section-kicker">{copy.workspace}</span><Typography component="h1">{copy.scanPreview}</Typography></div>
                <div className="workspace-heading-side">
                  <div className="page-count"><DescriptionRounded /><strong>{pages.length.toString().padStart(2, '0')}</strong><span>{pages.length === 1 ? copy.page : copy.pages}</span></div>
                  <Button className="add-page-workspace" variant="outlined" startIcon={<AddRounded />} onClick={() => fileInputRef.current?.click()}>{copy.addPages}</Button>
                </div>
              </div>

              {engineStatus === 'error' && <Alert severity="error" className="engine-error">{engineError || copy.scanEngineError}</Alert>}
              <div className="editor-layout">
                <section className="editor-main-column">
                  {activePage && (
                    <Paper elevation={0} className="editor-card">
                      <div className="viewer-toolbar">
                        <div className="file-heading">
                          <div className="file-type-icon"><ImageRounded /></div>
                          <div className="file-name-wrap"><Typography className="file-name" title={activePage.name}>{activePage.name}</Typography><Typography className="file-meta">{formatFileSize(activePage.file.size)} <span>·</span> {activePage.width.toLocaleString()} × {activePage.height.toLocaleString()}</Typography></div>
                        </div>
                        <div className="viewer-actions">
                          <Tooltip title={copy.rotate}><IconButton aria-label={copy.rotate} onClick={() => updateActive({ rotation: (activePage.rotation + 90) % 360 })}><RotateRightRounded /></IconButton></Tooltip>
                          <Tooltip title={copy.removePage}><IconButton aria-label={copy.removePage} onClick={() => removePage(activePage.id)}><DeleteOutlineRounded /></IconButton></Tooltip>
                          <Button
                            className={`crop-toggle ${cropMode ? 'crop-toggle-active' : ''}`}
                            variant={cropMode ? 'contained' : 'outlined'}
                            startIcon={<CropFreeRounded />}
                            onClick={() => setCropMode((current) => !current)}
                          >{cropMode ? copy.finishCorners : copy.editCorners}</Button>
                        </div>
                      </div>
                      <div className="stage-wrap">
                        <ImageStage
                          page={activePage}
                          cropMode={cropMode}
                          onCornersChange={(corners) => updateActive({ corners, detectionAttempted: true, detected: false })}
                          labels={copy}
                        />
                        {activePage.isProcessing && !activePage.previewUrl && (
                          <div className="first-process-state"><CircularProgress size={22} /><span>{activePage.detectionAttempted ? copy.updating : copy.findingEdges}</span></div>
                        )}
                        {activePage.processError && <div className="process-error"><Alert severity="error">{activePage.processError}</Alert></div>}
                        {!cropMode && activePage.previewUrl && (
                          <div className="stage-status"><span className={activePage.detected ? 'status-dot status-dot-good' : 'status-dot'} />{activePage.detected ? copy.detected : copy.notDetected}</div>
                        )}
                      </div>
                      <div className="viewer-footnote"><span><LockRounded />{copy.privateNote}</span><span>{copy.dropMore}</span></div>
                    </Paper>
                  )}

                  <div className="page-strip-head"><Typography component="h2">{copy.pages} <span>{pages.length.toString().padStart(2, '0')}</span></Typography><span>{copy.dropMore}</span></div>
                  <div className="page-strip">
                    {pages.map((page, index) => (
                      <div className={`page-item ${page.id === activeId ? 'page-item-active' : ''}`} key={page.id}>
                        <ButtonBase className="page-item-main" onClick={() => { setActiveId(page.id); setCropMode(false); }} aria-label={`${copy.page} ${index + 1}: ${page.name}`}>
                          <span className="page-item-thumbnail">{page.previewUrl ? <img src={page.previewUrl} alt="" /> : <DescriptionRounded />}</span>
                          <span className="page-item-caption"><span>{copy.page} {String(index + 1).padStart(2, '0')}</span><strong>{page.name}</strong></span>
                        </ButtonBase>
                        <Tooltip title={copy.removePage}><IconButton className="page-remove-button" size="small" aria-label={copy.removePage} onClick={() => removePage(page.id)}><CloseRounded /></IconButton></Tooltip>
                      </div>
                    ))}
                    <ButtonBase className="page-add-tile" onClick={() => fileInputRef.current?.click()}><AddRounded /><span>{copy.addPages}</span></ButtonBase>
                  </div>
                </section>

                {activePage && (
                  <aside className="settings-column">
                    <Paper elevation={0} className="settings-card">
                      <div className="settings-heading"><div className="settings-heading-icon"><AutoAwesomeRounded /></div><div><span className="section-kicker">{copy.enhancement}</span><Typography component="h2">{copy.makeScanReady}</Typography></div></div>
                      <div className="preset-grid">
                        {presetOptions.map(({ id, labelKey, descriptionKey, Icon }) => (
                          <ButtonBase
                            key={id}
                            className={`preset-option ${activePage.mode === id ? 'preset-option-active' : ''}`}
                            onClick={() => updateActive({ mode: id })}
                            aria-pressed={activePage.mode === id}
                          >
                            <span className="preset-icon"><Icon /></span>
                            <span className="preset-copy"><strong>{copy[labelKey]}</strong><small>{copy[descriptionKey]}</small></span>
                            {activePage.mode === id && <CheckCircleRounded className="preset-check" />}
                          </ButtonBase>
                        ))}
                      </div>

                      {activePage.mode === 'smart' && <Typography className="smart-mode-note">{copy.smartNote}</Typography>}
                      {activePage.mode === 'smart' && (
                        <div className="option-block">
                          <span className="option-title">{copy.linesTitle}</span>
                          <ToggleButtonGroup
                            className="lines-toggle"
                            exclusive
                            fullWidth
                            size="small"
                            value={activePage.settings.keepLines === false ? 'text' : 'lines'}
                            onChange={(_, value) => value && updateActive({ settings: { ...activePage.settings, keepLines: value === 'lines' } })}
                            aria-label={copy.linesTitle}
                          >
                            <ToggleButton value="lines">{copy.keepLines}</ToggleButton>
                            <ToggleButton value="text">{copy.textOnly}</ToggleButton>
                          </ToggleButtonGroup>
                        </div>
                      )}
                      <FormControlLabel
                        className="straighten-toggle"
                        control={<Switch checked={activePage.settings.straighten !== false} onChange={(event) => updateActive({ settings: { ...activePage.settings, straighten: event.target.checked } })} />}
                        label={copy.straightenLabel}
                      />
                      <Divider className="settings-divider" />
                      {['smart', 'bw'].includes(activePage.mode) && (
                        <div className="slider-control">
                          <div className="slider-label-row"><label htmlFor="paper-cleanup">{copy.paperCleanup}</label><span>{activePage.settings.cleanup}%</span></div>
                          <Slider id="paper-cleanup" size="small" min={0} max={100} value={activePage.settings.cleanup} onChange={(_, value) => updateActive({ settings: { ...activePage.settings, cleanup: value } })} aria-label={copy.paperCleanup} />
                          <div className="slider-range-labels"><span>{copy.softer}</span><span>{copy.stronger}</span></div>
                        </div>
                      )}
                      <div className="slider-control exposure-control">
                        <div className="slider-label-row"><label htmlFor="scan-exposure">{copy.exposure}</label><span>{activePage.settings.exposure > 0 ? '+' : ''}{activePage.settings.exposure}</span></div>
                        <Slider id="scan-exposure" size="small" min={-30} max={30} value={activePage.settings.exposure} onChange={(_, value) => updateActive({ settings: { ...activePage.settings, exposure: value } })} aria-label={copy.exposure} />
                        <div className="slider-range-labels"><span>{copy.darker}</span><span>{copy.brighter}</span></div>
                      </div>

                      <Divider className="settings-divider" />
                      <div className="crop-tools-heading"><span><CropFreeRounded />{copy.pageShape}</span><span className={`detect-pill ${activePage.detected ? 'detect-pill-found' : ''}`}><i />{activePage.detected ? copy.detected : copy.notDetected}</span></div>
                      <Button className="detect-button" fullWidth variant="outlined" startIcon={<AutoAwesomeRounded />} onClick={runAutoDetect} disabled={engineStatus !== 'ready'}>{copy.autoDetect}</Button>
                      <Button className="reset-crop-button" fullWidth onClick={() => updateActive({ corners: getFullFrame(activePage.width, activePage.height), detected: false, detectionAttempted: true })}>{copy.resetCrop}</Button>

                      <div className="export-area">
                        <div className="export-controls">
                          <Button className="export-button" fullWidth variant="contained" startIcon={exporting ? <CircularProgress size={17} color="inherit" /> : <PictureAsPdfRounded />} onClick={exportPdf} disabled={engineStatus !== 'ready' || exporting}>
                            {exporting ? copy.exporting : copy.savePdf}
                          </Button>
                          <Tooltip title={copy.saveImage}>
                            <IconButton className="export-more" aria-label={copy.moreExport} onClick={(event) => setMenuAnchor(event.currentTarget)} disabled={engineStatus !== 'ready' || exporting}><MoreHorizRounded /></IconButton>
                          </Tooltip>
                        </div>
                        <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)} PaperProps={{ className: 'export-menu' }}>
                          <MenuItem onClick={exportPdf}><PictureAsPdfRounded />{copy.savePdf} · {pages.length}</MenuItem>
                          <MenuItem onClick={exportCurrentImage}><ImageRounded />{copy.saveImage}</MenuItem>
                        </Menu>
                        <div className="export-trust"><LockRounded />{copy.localNote}</div>
                      </div>
                    </Paper>
                    <div className="settings-bottom-note"><CloudOffRounded /><span>{copy.privacyBody}</span></div>
                  </aside>
                )}
              </div>
            </>
          )}
        </main>

        {!pages.length && <footer className="page-footer"><BrandMark /><span>ScanMX</span><i />{copy.footer}<span className="footer-version">{copy.localEngine}</span></footer>}
        {dragActive && <div className="global-drop-indicator"><div><UploadFileRounded /><strong>{copy.dropTitle}</strong><span>{copy.dropBody}</span></div></div>}
        <Snackbar open={snackbar.open} autoHideDuration={3600} onClose={() => setSnackbar((current) => ({ ...current, open: false }))} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
          <Alert onClose={() => setSnackbar((current) => ({ ...current, open: false }))} severity={snackbar.severity} variant="filled" className="snackbar-alert">{snackbar.message}</Alert>
        </Snackbar>
      </div>
    </ThemeProvider>
  );
}

export default App;
