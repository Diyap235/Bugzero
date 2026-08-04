<div align="center">

# 🚀 BugZero

### AI-Powered Repository Review Platform

**Understand Your Repository Before Production.**

BugZero is a modern AI-powered repository review platform that combines **Static Analysis**, **Machine Learning**, and **Explainable AI** to help developers discover bugs, security vulnerabilities, code smells, and technical debt before software reaches production.

<p>
<a href="#">🌐 Live Demo</a> •
<a href="#">📖 Documentation</a> •
<a href="#">🐞 Report Bug</a> •
<a href="#">💡 Request Feature</a>
</p>

<img src="./docs/images/banner.png" width="100%" alt="BugZero Banner"/>

<br>

![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=nextdotjs)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)
![FastAPI](https://img.shields.io/badge/FastAPI-Backend-009688?logo=fastapi)
![Python](https://img.shields.io/badge/Python-3.12-yellow?logo=python)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Database-336791?logo=postgresql)
![Docker](https://img.shields.io/badge/Docker-Container-2496ED?logo=docker)
![MIT License](https://img.shields.io/badge/License-MIT-green)

</div>

---

# ✨ Why BugZero?

Traditional code review tools detect issues.

**BugZero explains them.**

Instead of overwhelming developers with warnings, BugZero analyzes repositories using Static Analysis, Machine Learning, and Explainable AI to provide actionable engineering insights with confidence scores, suggested fixes, repository health tracking, and professional reports.

The goal is simple:

> **Help developers understand their repository before production.**

---

# 🚀 Features

### 🤖 AI Repository Review

- AI-powered repository analysis
- Explainable AI (XAI)
- Repository Health Score
- Smart Bug Classification
- Confidence Scoring

---

### 🔍 Static Analysis

- Pylint Integration
- Bandit Security Scanner
- Code Quality Checks
- Security Vulnerability Detection
- Code Smell Detection

---

### 📊 Repository Health

- Health Score
- Security Score
- Quality Score
- Technical Debt
- Historical Trends
- Review Timeline

---

### 📄 Reports

- Professional Reports
- PDF Export
- JSON Export
- Review History
- Repository Analytics

---

### ⚡ Modern Developer Experience

- Beautiful Dark UI
- VS Code Inspired Workspace
- AI Assistant
- Smooth Animations
- Responsive Design

---

# 🧠 AI Review Pipeline

```text
Repository

        │
        ▼

Static Analysis
(Pylint + Bandit)

        │
        ▼

CodeBERT Embeddings

        │
        ▼

ML Classification

        │
        ▼

Confidence Scoring

        │
        ▼

Explainable AI

        │
        ▼

Suggested Fix

        │
        ▼

Repository Health

        │
        ▼

Professional Report
```

---

# 📸 Screenshots

| Landing | Repository Workspace |
|----------|----------------------|
| ![](docs/images/landing.png) | ![](docs/images/workspace.png) |

| Findings | Repository Health |
|-----------|-------------------|
| ![](docs/images/findings.png) | ![](docs/images/health.png) |

| Reports | Settings |
|----------|----------|
| ![](docs/images/reports.png) | ![](docs/images/settings.png) |

---

# 🏗️ Architecture

```text
                    Frontend
                  (Next.js 15)

                        │
                        ▼

                FastAPI REST API

                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼

 Authentication    AI Engine      Report Service

        │               │               │

        ▼               ▼               ▼

 PostgreSQL      CodeBERT + LLM     Export Engine

        │
        ▼

 Repository Data
```

---

# 🛠️ Tech Stack

| Category | Technologies |
|-----------|--------------|
| Frontend | Next.js 15, TypeScript, Tailwind CSS, Framer Motion, Monaco Editor |
| Backend | FastAPI, SQLAlchemy, Alembic |
| Database | PostgreSQL |
| AI | Pylint, Bandit, CodeBERT, OpenAI |
| Authentication | JWT, Refresh Tokens, bcrypt |
| DevOps | Docker, Docker Compose, GitHub Actions |

---

# 📂 Project Structure

```text
BugZero
│
├── frontend
│   ├── app
│   ├── components
│   ├── hooks
│   ├── services
│   ├── types
│   └── utils
│
├── backend
│   ├── api
│   ├── services
│   ├── repositories
│   ├── models
│   ├── schemas
│   └── core
│
├── ml
│   ├── models
│   ├── training
│   ├── inference
│   └── datasets
│
├── docs
│
├── docker
│
└── README.md
```

---

# 🚀 Getting Started

Clone the repository

```bash
git clone https://github.com/Diyap235/Bugzero.git
```

Move into the project

```bash
cd bugzero
```

Install Frontend

```bash
cd frontend

npm install

npm run dev
```

Install Backend

```bash
cd backend

pip install -r requirements.txt

uvicorn app.main:app --reload
```

---

# 🎯 Roadmap

- [x] Landing Page
- [x] Authentication
- [x] Repository Workspace
- [x] AI Repository Review
- [x] Repository Health
- [x] Reports
- [ ] GitHub Integration
- [ ] VS Code Extension
- [ ] Team Collaboration
- [ ] Background Workers
- [ ] Multi-language Support
- [ ] Cloud Deployment

---

# 🤝 Contributing

Contributions are welcome!

1. Fork the repository

2. Create a feature branch

```bash
git checkout -b feature/amazing-feature
```

3. Commit your changes

```bash
git commit -m "feat: add amazing feature"
```

4. Push

```bash
git push origin feature/amazing-feature
```

5. Open a Pull Request

---

# 📄 License

This project is licensed under the **MIT License**.

---

# ⭐ Support

If you like this project, consider giving it a ⭐ on GitHub.

It helps the project grow and motivates future development.

---

<div align="center">

## Built with ❤️ for Developers

### **BugZero — Understand Your Repository Before Production.**

</div>