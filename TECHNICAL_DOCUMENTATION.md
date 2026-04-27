# Canvas AI Assistant - Technical Documentation

## Architecture Overview

The Canvas AI Assistant is built using a modern web architecture with three main components:

1. **Chrome Extension Frontend** - User interface and Canvas integration
2. **Backend API Server** - AI processing and data management
3. **Content Scripts** - Canvas data extraction and DOM manipulation

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Chrome        │     │   Backend API   │     │   OpenAI API    │
│   Extension     │────▶│   Server        │────▶│                 │
│                 │◀────│                 │◀────│                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                        │                        │
        └────────────────────────┴────────────────────────┘
                                │
                    ┌─────────────────┐
                    │   Canvas LMS    │
                    │   Platform      │
                    └─────────────────┘
```

## Component Details

### 1. Chrome Extension (Manifest V3)

**Location**: `/extension/`

**Key Files:**
- `manifest.json` - Extension configuration and permissions
- `background.js` - Service worker for extension lifecycle
- `content.js` - Canvas data extraction script
- `content-styles.css` - Chatbot UI styling
- `popup/` - Extension popup interface
- `options/` - Settings page
- `chatbot/` - AI chatbot interface

**Permissions:**
- `storage` - Local data persistence
- `activeTab` - Current tab access
- `scripting` - Script injection
- `cookies` - Session management
- `https://*.instructure.com/*` - Canvas domain access

**Features:**
- Automatic Canvas page detection
- SSO authentication via existing session
- Real-time data extraction
- AI chatbot overlay
- Settings management

### 2. Backend API Server

**Location**: `/backend/`

**Technology Stack:**
- **Express.js** - Web framework
- **OpenAI SDK** - AI integration
- **Winston** - Logging system
- **Rate Limiter** - API protection
- **CORS** - Cross-origin support

**API Endpoints:**

#### Health Check
```http
GET /api/health
```
Returns server status and version information.

#### Data Sync
```http
POST /api/sync
Content-Type: application/json

{
  "canvasData": { ... },
  "sessionId": "optional_session_id"
}
```
Syncs Canvas data with the backend server.

#### AI Chat
```http
POST /api/chat
Content-Type: application/json

{
  "message": "user_message",
  "canvasData": { ... },
  "apiKey": "user_openai_key",
  "settings": { ... }
}
```
Processes AI chat requests with Canvas context.

#### Analytics
```http
GET /api/analytics/{sessionId}
```
Generates academic analytics from Canvas data.

#### Settings Management
```http
POST /api/settings
GET /api/settings/{sessionId}
```
Manages user preferences and configurations.

### 3. Data Flow

```
1. User visits Canvas → Content Script detects page
2. Content Script extracts data → Stores in chrome.storage
3. User opens chatbot → Popup requests AI response
4. Background script → Calls backend API
5. Backend processes → Returns AI response
6. Chatbot displays → User interacts
```

## Data Extraction Strategy

### Canvas Data Sources

The extension extracts data from multiple Canvas page elements:

#### 1. Dashboard Data
```javascript
// Course cards
const courseCards = document.querySelectorAll('[data-testid="course-card"]');
const courseData = {
  id: extractCourseIdFromUrl(card.href),
  name: card.querySelector('.course-title').textContent,
  code: card.querySelector('.course-code').textContent,
  isFavorite: true
};
```

#### 2. Assignment Data
```javascript
// From assignments page
const assignmentRows = document.querySelectorAll('.assignment .title');
const assignmentData = {
  id: generateId(title),
  title: title,
  dueDate: parseDate(dueDate),
  points: parsePoints(points),
  status: determineStatus(element)
};
```

#### 3. Grade Information
```javascript
// From grades page or dashboard
const gradeData = {
  courseId: courseId,
  overallGrade: gradeElement.textContent,
  assignments: gradeRows.map(row => ({
    assignment: title,
    grade: grade,
    percentage: calculatePercentage(grade, pointsPossible)
  }))
};
```

#### 4. User Information
```javascript
// From user menu and ENV variables
const userData = {
  id: window.ENV?.current_user_id,
  name: userMenu.textContent.trim(),
  email: window.ENV?.current_user?.email
};
```

### Data Storage

All data is stored locally using Chrome's storage API:

```javascript
// Store extracted data
await chrome.storage.local.set({
  'canvasData': extractedData,
  'lastUpdate': new Date().toISOString()
});

// Retrieve data
const result = await chrome.storage.local.get(['canvasData']);
```

## AI Integration

### OpenAI API Integration

The backend server integrates with OpenAI's GPT-4o model:

```javascript
const completion = await openai.chat.completions.create({
  model: settings.aiModel || 'gpt-4o',
  messages: [{ role: 'user', content: context }],
  max_tokens: settings.maxTokens || 1000,
  temperature: settings.aiTemperature || 0.7
});
```

### Context Preparation

The system prepares rich context for AI responses:

```javascript
function prepareAIContext(canvasData, userMessage, settings) {
  let context = `You are a helpful AI assistant for Canvas LMS students...
  
  Student Information:
  - Name: ${canvasData.user?.name}
  - Email: ${canvasData.user?.email}
  
  Current Courses: ${canvasData.courses?.length}
  Upcoming Assignments: ${upcomingAssignments.length}
  
  User Question: ${userMessage}`;
  
  return context;
}
```

### Response Formatting

AI responses are formatted for better readability:

```javascript
function formatMessageContent(content) {
  return content
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}
```

## Security Implementation

### 1. Content Security Policy

```javascript
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.openai.com"]
    }
  }
}));
```

### 2. CORS Configuration

```javascript
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? 
    process.env.ALLOWED_ORIGINS.split(',') : 
    ['chrome-extension://*'],
  credentials: true
}));
```

### 3. Rate Limiting

```javascript
const rateLimiter = new RateLimiterMemory({
  keyPrefix: 'canvas_ai_api',
  points: 100,
  duration: 60 * 60
});
```

### 4. Data Validation

```javascript
function validateCanvasData(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid canvas data format');
  }
  
  // Validate required fields
  if (!data.user || !data.courses) {
    throw new Error('Missing required data fields');
  }
  
  return true;
}
```

## Performance Optimization

### 1. Efficient DOM Querying

```javascript
// Use specific selectors
const courseCards = document.querySelectorAll('[data-testid="course-card"]');

// Batch operations
const courses = Array.from(courseCards).map(card => extractCourseData(card));

// Avoid repeated queries
const userMenu = document.querySelector('[data-testid="user-menu"]');
const userData = userMenu ? extractUserData(userMenu) : {};
```

### 2. Smart Updates

```javascript
// Only update changed data
const oldData = await chrome.storage.local.get(['canvasData']);
const newData = extractCanvasData();

if (hasSignificantChanges(oldData, newData)) {
  await chrome.storage.local.set({ canvasData: newData });
}
```

### 3. Background Processing

```javascript
// Use background script for heavy operations
chrome.runtime.sendMessage({
  type: 'PROCESS_CANVAS_DATA',
  data: canvasData
});
```

### 4. Lazy Loading

```javascript
// Load chatbot only when needed
if (userWantsChatbot) {
  injectChatbotUI();
}
```

## Error Handling

### 1. Graceful Degradation

```javascript
async function getAIResponse(message) {
  try {
    if (!apiKey) {
      return getOfflineResponse(message);
    }
    
    const response = await callOpenAI(apiKey, message);
    return response;
    
  } catch (error) {
    logger.error('AI request failed:', error);
    return getOfflineResponse(message);
  }
}
```

### 2. User-Friendly Errors

```javascript
function handleAIError(error) {
  if (error.message.includes('API key')) {
    return "Please configure your OpenAI API key in settings.";
  }
  
  if (error.message.includes('rate limit')) {
    return "AI service is busy. Please try again later.";
  }
  
  return "I'm having trouble connecting to the AI service.";
}
```

### 3. Logging and Monitoring

```javascript
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});
```

## Testing Strategy

### 1. Unit Tests

```javascript
describe('CanvasDataExtractor', () => {
  test('should extract course data correctly', () => {
    const mockData = createMockCanvasPage();
    const extractor = new CanvasDataExtractor(mockData);
    
    expect(extractor.courses).toHaveLength(5);
    expect(extractor.courses[0]).toHaveProperty('name');
    expect(extractor.courses[0]).toHaveProperty('id');
  });
});
```

### 2. Integration Tests

```javascript
describe('AI Chat Integration', () => {
  test('should process chat request successfully', async () => {
    const response = await request(app)
      .post('/api/chat')
      .send({
        message: 'Show my assignments',
        canvasData: mockCanvasData,
        apiKey: 'test-api-key'
      });
    
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('response');
  });
});
```

### 3. End-to-End Tests

```javascript
describe('Extension E2E', () => {
  test('should extract data from Canvas', async () => {
    await page.goto('https://canvas.instructure.com');
    await page.waitForSelector('[data-testid="course-card"]');
    
    const courses = await page.evaluate(() => {
      return window.canvasExtractor.getCourses();
    });
    
    expect(courses.length).toBeGreaterThan(0);
  });
});
```

## Deployment Considerations

### 1. Production Backend

```javascript
// Use environment-specific configurations
const config = {
  development: {
    cors: ['http://localhost:3000'],
    logging: 'debug'
  },
  production: {
    cors: ['https://yourdomain.com'],
    logging: 'warn',
    trustProxy: true
  }
};
```

### 2. Database Migration

```javascript
// Replace in-memory storage with database
const dataStore = process.env.NODE_ENV === 'production' 
  ? new DatabaseStore() 
  : new MemoryStore();
```

### 3. Monitoring

```javascript
// Add health checks and metrics
app.get('/api/metrics', (req, res) => {
  res.json({
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    activeSessions: dataStore.size,
    requestCount: requestCounter
  });
});
```

## Future Enhancements

### 1. Multi-Provider AI Support
- Google Gemini API
- Anthropic Claude API
- Local AI models

### 2. Advanced Analytics
- Study pattern analysis
- Performance predictions
- Personalized recommendations

### 3. Collaboration Features
- Study group coordination
- Assignment sharing
- Peer comparison (privacy-focused)

### 4. Mobile Support
- Progressive Web App
- Mobile-optimized UI
- Push notifications

## Maintenance Guidelines

### 1. Regular Updates
- Keep dependencies updated
- Monitor Canvas UI changes
- Update AI models as needed

### 2. Performance Monitoring
- Track API response times
- Monitor memory usage
- Analyze user feedback

### 3. Security Audits
- Regular dependency scans
- Review access permissions
- Update security policies

---

This technical documentation provides a comprehensive overview of the Canvas AI Assistant architecture, implementation details, and best practices for development and maintenance.