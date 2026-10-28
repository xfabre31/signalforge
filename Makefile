.PHONY: setup test build

setup:
	python3.12 -m venv .venv
	.venv/bin/python -m pip install -r backend/requirements.txt
	.venv/bin/python -m pip install --force-reinstall --no-deps uvicorn==0.35.0
	cd frontend && npm install

test:
	.venv/bin/python -m pytest backend/tests

build:
	cd frontend && npm run build

