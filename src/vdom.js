/*
 * Copyright (c) 2015, Joel Richard
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

var cito = window.cito || {};
(function (cito, window, undefined) {
    'use strict';

    var document = window.document,
        noop = function () {},
        console = window.console || {warn: noop, error: noop};

    var helperDiv = document.createElement('div'),
        supportsTextContent = 'textContent' in document,
        supportsEventListener = 'addEventListener' in document,
        supportsRange = 'createRange' in document,
        supportsCssSetProperty = 'setProperty' in helperDiv.style;

    function isString(value) {
        return typeof value === 'string';
    }

    function isArray(value) {
        return value instanceof Array;
    }

    function isFunction(value) {
        return typeof value === 'function';
    }

    function norm(node, oldNode) {
        var type = typeof node;
        return (type === 'string') ? {tag: '#', children: node} : (type === 'function') ? norm(node(oldNode), oldNode) : node;
    }

    function normIndex(children, i, oldChild) {
        var origChild = children[i],
            child = norm(origChild, oldChild);
        if (origChild !== child) {
            children[i] = child;
        }
        return child;
    }

    function normOnly(children) {
        var onlyChild = isArray(children) ? children[0] : children;
        return norm(onlyChild);
    }

    function normOnlyOld(children, domElement) {
        var onlyChild = normOnly(children);
        if (onlyChild && !onlyChild.dom) {
            onlyChild.dom = domElement.firstChild;
        }
        return onlyChild;
    }

    function normChildren(node, children, oldChildren) {
        if (children && isFunction(children)) {
            node.children = children = children(oldChildren);
        }
        return children;
    }

    function setTextContent(domElement, text) {
        if (supportsTextContent) {
            domElement.textContent = text;
        } else {
            domElement.innerText = text;
        }
    }

    function insertOrAppend(domElement, domChild, nextChild) {
        if (nextChild) {
            domElement.insertBefore(domChild, nextChild.dom);
        } else {
            domElement.appendChild(domChild);
        }
    }

    function createNode(node, parent) {
        var domNode,
            tag = node.tag,
            children = node.children;
        switch (tag) {
            case '#':
                domNode = document.createTextNode(children);
                break;
            case '!':
                domNode = document.createComment(children);
                break;
            case '<':
                // TODO improve performance with insertAdjacentHTML
                if (children) {
                    helperDiv.innerHTML = children;
                    var fragment = document.createDocumentFragment(),
                        child;
                    while (child = helperDiv.firstChild) { // jshint ignore:line
                        fragment.appendChild(child);
                    }
                    node.dom = fragment.firstChild;
                    node.domSize = fragment.childNodes.length;
                    return fragment;
                } else {
                    domNode = document.createTextNode('');
                }
                break;
            default:
                var namespace;
                switch (tag) {
                    case 'svg': namespace = 'http://www.w3.org/2000/svg'; break;
                    case 'math': namespace = 'http://www.w3.org/1998/Math/MathML'; break;
                    default: namespace = parent && parent.ns;
                }
                if (namespace) {
                    node.ns = namespace;
                    domNode = document.createElementNS(namespace, tag);
                } else {
                    domNode = document.createElement(tag);
                }
                updateElement(domNode, null, null, node, tag, node.attrs, node.events);
                createChildren(domNode, node, normChildren(node, children));
        }
        node.dom = domNode;
        return domNode;
    }

    function updateElement(domElement, oldAttrs, oldEvents, element, tag, attrs, events) {
        // Attributes
        var attrName;
        if (attrs) {
            for (attrName in attrs) {
                var attrValue = attrs[attrName];
                if (attrName === 'style') {
                    var oldAttrValue = oldAttrs && oldAttrs[attrName];
                    if (oldAttrValue !== attrValue) {
                        updateStyle(domElement, oldAttrValue, attrs, attrValue);
                    }
                } else if (isInputProperty(tag, attrName)) {
                    if (domElement[attrName] !== attrValue) {
                        domElement[attrName] = attrValue;
                    }
                } else if (!oldAttrs || oldAttrs[attrName] !== attrValue) {
                    if (attrValue === false) {
                        domElement.removeAttribute(attrName);
                    } else {
                        if (attrValue === true) {
                            attrValue = '';
                        }
                        var colonIndex = attrName.indexOf(':'), namespace;
                        if (colonIndex !== -1) {
                            var prefix = attrName.substr(0, colonIndex);
                            switch (prefix) {
                                case 'xlink':
                                    namespace = 'http://www.w3.org/1999/xlink';
                                    break;
                            }
                        }
                        if (namespace) {
                            domElement.setAttributeNS(namespace, attrName, attrValue);
                        } else {
                            domElement.setAttribute(attrName, attrValue);
                        }
                    }
                }
            }
        }
        if (oldAttrs) {
            for (attrName in oldAttrs) {
                if (!attrs || attrs[attrName] === undefined) {
                    if (isInputProperty(tag, attrName)) {
                        domElement[attrName] = '';
                    } else {
                        domElement.removeAttribute(attrName);
                    }
                }
            }
        }

        // Events
        var eventType;
        if (events) {
            domElement.virtualNode = element;
            for (eventType in events) {
                if (!oldEvents || !oldEvents[eventType]) {
                    addEventHandler(domElement, eventType);
                }
            }
        }
        if (oldEvents) {
            for (eventType in oldEvents) {
                if (!events || !events[eventType]) {
                    removeEventHandler(domElement, eventType);
                }
            }
        }
    }

    function updateStyle(domElement, oldStyle, attrs, style) {
        var propName;
        if (!isString(style) && (!supportsCssSetProperty || !oldStyle || isString(oldStyle))) {
            var styleStr = '';
            if (style) {
                for (propName in style) {
                    styleStr += propName + ': ' + style[propName] + '; ';
                }
            }
            style = styleStr;
            if (!supportsCssSetProperty) {
                attrs.style = style;
            }
        }
        var domStyle = domElement.style;
        if (isString(style)) {
            domStyle.cssText = style;
        } else {
            if (style) {
                for (propName in style) {
                    // TODO should important properties even be supported?
                    var propValue = style[propName];
                    if (!oldStyle || oldStyle[propName] !== propValue) {
                        var importantIndex = propValue.indexOf('!important');
                        if (importantIndex !== -1) {
                            domStyle.setProperty(propName, propValue.substr(0, importantIndex), 'important');
                        } else {
                            if (oldStyle) {
                                var oldPropValue = oldStyle[propName];
                                if (oldPropValue && oldPropValue.indexOf('!important') !== -1) {
                                    domStyle.removeProperty(propName);
                                }
                            }
                            domStyle.setProperty(propName, propValue, '');
                        }
                    }
                }
            }
            if (oldStyle) {
                for (propName in oldStyle) {
                    if (!style || style[propName] === undefined) {
                        domStyle.removeProperty(propName);
                    }
                }
            }
        }
    }

    function isInputProperty(tag, attrName) {
        switch (tag) {
            case 'input':
                return attrName === 'value' || attrName === 'checked';
            case 'textarea':
                return attrName === 'value';
            case 'select':
                return attrName === 'selectedIndex';
            case 'option':
                return attrName === 'selected';
        }
    }

    function addEventHandler(domElement, type) {
        if (supportsEventListener) {
            domElement.addEventListener(type, eventHandler, false);
        } else {
            var onType = 'on' + type;
            if (onType in domElement) {
                domElement[onType] = eventHandler;
            } else {
                domElement.attachEvent(onType, eventHandler);
            }
        }
    }

    function removeEventHandler(domElement, type) {
        if (supportsEventListener) {
            domElement.removeEventListener(type, eventHandler, false);
        } else {
            var onType = 'on' + type;
            if (onType in domElement) {
                domElement[onType] = null;
            } else {
                domElement.detachEvent(onType, eventHandler);
            }
        }
    }

    function updateChildren(domElement, element, oldChildren, children) {
        var oldChildrenSize = getChildrenSize(oldChildren);
        if (oldChildrenSize === 0) {
            createChildren(domElement, element, children);
        } else {
            var childrenSize = getChildrenSize(children);
            if (childrenSize === 0) {
                if (oldChildrenSize === 1) {
                    if (getOnlyChildIfText(oldChildren) !== null) {
                        domElement.removeChild(domElement.firstChild);
                    } else {
                        removeChild(domElement, normOnlyOld(oldChildren, domElement));
                    }
                } else if (oldChildrenSize > 1) {
                    oldChildren = toOldChildrenArray(oldChildren, oldChildrenSize, domElement);
                    removeChildren(domElement, oldChildren, 0, oldChildrenSize);
                }
            } else if (oldChildrenSize === 1 && childrenSize === 1) {
                var oldChildText = getOnlyChildIfText(oldChildren), childText;
                if (oldChildText !== null && (childText = getOnlyChildIfText(children)) !== null) {
                    if (oldChildText !== childText) {
                        setTextContent(domElement, childText);
                    }
                } else {
                    var oldChild = normOnlyOld(oldChildren, domElement),
                        child = normOnly(children);
                    updateNode(oldChild, child, element, domElement);
                }
            } else {
                oldChildren = toOldChildrenArray(oldChildren, oldChildrenSize, domElement);
                children = toChildrenArray(children, childrenSize, element);
                updateChildrenKey(domElement, element, oldChildren, children);
            }
        }
    }

    function createChildren(domElement, node, children) {
        var childrenSize = getChildrenSize(children);
        if (childrenSize === 1) {
            var text = getOnlyChildIfText(children);
            if (text !== null) {
                setTextContent(domElement, text);
            } else {
                domElement.appendChild(createNode(normOnly(children), node));
            }
        } else if (childrenSize > 1) {
            children = toChildrenArray(children, childrenSize, node);
            for (var i = 0, len = children.length; i < len; i++) {
                domElement.appendChild(createNode(normIndex(children, i), node));
            }
        }
    }

    function getChildrenSize(children) {
        return isArray(children) ? children.length : children || isString(children) ? 1 : 0;
    }

    function toOldChildrenArray(children, size, domElement) {
        children = (size > 1) ? children : isArray(children) ? children : [children];
        if (size === 1) {
            var onlyChild = normIndex(children, 0);
            if (!onlyChild.dom) {
                onlyChild.dom = domElement.firstChild;
            }
        }
        return children;
    }

    function toChildrenArray(children, size, element) {
        return (size > 1) ? children : isArray(children) ? children : (element.children = [children]);
    }

    function getOnlyChildIfText(children) {
        var onlyChild = isArray(children) ? children[0] : children;
        return isString(onlyChild) ? onlyChild : (onlyChild.tag === '#') ? onlyChild.children : null;
    }

    var range = supportsRange ? document.createRange() : null;

    function removeChildren(domElement, children, from, to) {
        var count = to - from, i;
        if (count === 1) {
            removeChild(domElement, children[from]);
            /* TODO use range for better performance with many children
        } else if (hasRange && count === children.length) {
            // TODO use setStartBefore/setEndAfter for faster range delete
            for (i = from; i < to; i++) {
                destroyNode(children[i]);
            }
            range.selectNodeContents(domElement);
            range.deleteContents();
            */
        } else {
            for (i = from; i < to; i++) {
                removeChild(domElement, children[i]);
            }
        }
    }

    function removeChild(domElement, child) {
        destroyNode(child);
        var domNode = child.dom, nextDomNode;
        for (var domSize = child.domSize || 1; domSize--;) {
            nextDomNode = (domSize > 0) ? domNode.nextSibling : null;
            domElement.removeChild(domNode);
            domNode = nextDomNode;
        }
    }

    function updateChildrenKey(domElement, element, oldChildren, children) {
        var oldStartIndex = 0, oldEndIndex = oldChildren.length - 1,
            startIndex = 0, endIndex = children.length - 1,
            successful = true;

        outer: while (successful && oldStartIndex <= oldEndIndex && startIndex <= endIndex) {
            successful = false;
            var oldStartChild, oldEndChild, startChild, endChild;

            oldStartChild = oldChildren[oldStartIndex];
            startChild = normIndex(children, startIndex, oldStartChild);
            while (oldStartChild.key === startChild.key) {
                updateNode(oldStartChild, startChild, element);
                oldStartIndex++; startIndex++;
                if (oldStartIndex > oldEndIndex || startIndex > endIndex) {
                    break outer;
                }
                oldStartChild = oldChildren[oldStartIndex];
                startChild = normIndex(children, startIndex, oldStartChild);
                successful = true;
            }
            oldEndChild = oldChildren[oldEndIndex];
            endChild = normIndex(children, endIndex, oldEndChild);
            while (oldEndChild.key === endChild.key) {
                updateNode(oldEndChild, endChild, element);
                oldEndIndex--; endIndex--;
                if (oldStartIndex > oldEndIndex || startIndex > endIndex) {
                    break outer;
                }
                oldEndChild = oldChildren[oldEndIndex];
                endChild = normIndex(children, endIndex);
                successful = true;
            }
            while (oldStartChild.key === endChild.key) {
                updateNode(oldStartChild, endChild, element);
                insertOrAppend(domElement, endChild.dom, children[endIndex + 1]);
                oldStartIndex++; endIndex--;
                if (oldStartIndex > oldEndIndex || startIndex > endIndex) {
                    break outer;
                }
                oldStartChild = oldChildren[oldStartIndex];
                endChild = normIndex(children, endIndex);
                successful = true;
            }
            while (oldEndChild.key === startChild.key) {
                updateNode(oldEndChild, startChild, element);
                domElement.insertBefore(startChild.dom, oldChildren[oldStartIndex].dom);
                oldEndIndex--; startIndex++;
                if (oldStartIndex > oldEndIndex || startIndex > endIndex) {
                    break outer;
                }
                oldEndChild = oldChildren[oldEndIndex];
                startChild = normIndex(children, startIndex);
                successful = true;
            }
        }

        if (oldStartIndex > oldEndIndex) {
            normIndex(children, startIndex);
            for (; startIndex <= endIndex; startIndex++) {
                insertOrAppend(domElement, createNode(children[startIndex], element), normIndex(children, endIndex + 1));
            }
        } else if (startIndex > endIndex) {
            removeChildren(domElement, oldChildren, oldStartIndex, oldEndIndex + 1);
        } else {
            // TODO create map with shorter list
            var i, oldChild,
                oldNextChild = oldChildren[oldEndIndex + 1],
                oldChildrenMap = {};
            for (i = oldEndIndex; i >= oldStartIndex; i--) {
                oldChild = oldChildren[i];
                oldChild.next = oldNextChild;
                oldChildrenMap[oldChild.key] = oldChild;
                oldNextChild = oldChild;
            }
            var nextChild = normIndex(children, endIndex + 1);
            for (i = endIndex; i >= startIndex; i--) {
                var child = children[i],
                    key = child.key;
                oldChild = oldChildrenMap[key];
                if (oldChild) {
                    oldChildrenMap[key] = null;
                    oldNextChild = oldChild.next;
                    var domNode = updateNode(oldChild, child, element);
                    if ((oldNextChild && oldNextChild.key) !== (nextChild && nextChild.key)) {
                        insertOrAppend(domElement, domNode, nextChild);
                    }
                } else {
                    insertOrAppend(domElement, createNode(child, element), nextChild);
                }
                nextChild = child;
            }
            for (i = oldStartIndex; i <= oldEndIndex; i++) {
                oldChild = oldChildren[i];
                if (oldChildrenMap[oldChild.key] !== null) {
                    removeChild(domElement, oldChild);
                }
            }
        }
    }

    var stopImmediate = false;

    function eventHandler(event) {
        event = getFixedEvent(event, this); // jshint ignore:line
        var currentTarget = event.currentTarget,
            eventHandlers = currentTarget.virtualNode.events[event.type];
        if (isArray(eventHandlers)) {
            for (var i = 0, len = eventHandlers.length; i < len; i++) {
                callEventHandler(eventHandlers[i], currentTarget, event);
                if (stopImmediate) {
                    stopImmediate = false;
                    break;
                }
            }
        } else {
            callEventHandler(eventHandlers, currentTarget, event);
        }
    }

    // jshint ignore:start
    function preventDefault() {
        this.defaultPrevented = true;
        this.returnValue = false;
    }
    function stopPropagation() {
        this.cancelBubble = true;
    }
    function stopImmediatePropagation() {
        stopImmediate = true;
        this.stopPropagation();
    }
    // jshint ignore:end

    function getFixedEvent(event, thisArg) {
        if (!event) {
            event = window.event;
            event.defaultPrevented = (event.returnValue === false);
            event.preventDefault = preventDefault;
            event.stopPropagation = stopPropagation;
            var target = event.target = event.srcElement;
            event.currentTarget = thisArg.nodeType ? thisArg : target; // jshint ignore:line
            // TODO further event normalization
        }
        event.stopImmediatePropagation = stopImmediatePropagation;
        return event;
    }

    function callEventHandler(eventHandler, currentTarget, event) {
        try {
            if (eventHandler.call(currentTarget, event) === false) {
                event.preventDefault();
            }
        } catch (e) {
            console.error(e.stack || e);
        }
    }

    function updateNode(oldNode, node, parent) {
        var domNode = oldNode.dom,
            tag = node.tag,
            domParent, domSize, nextDomNode;
        if (oldNode.tag !== tag) {
            domParent = domNode.parentNode;
            var oldDomNode = domNode;
            domNode = createNode(node, parent);
            destroyNode(oldNode);
            if (domParent) {
                domSize = oldNode.domSize;
                if (domSize > 1) {
                    domParent.insertBefore(domNode, oldDomNode);
                    while (domSize--) {
                        nextDomNode = (domSize > 0) ? oldDomNode.nextSibling : null;
                        domParent.removeChild(oldDomNode);
                        oldDomNode = nextDomNode;
                    }
                } else {
                    domParent.replaceChild(domNode, oldDomNode);
                }
            }
        } else {
            var oldChildren = oldNode.children,
                children = node.children;
            switch (tag) {
                case '#':
                case '!':
                    if (oldChildren !== children) {
                        domNode.nodeValue = children;
                    }
                    break;
                case '<':
                    // TODO improve performance with insertAdjacentHTML
                    if (oldChildren !== children) {
                        domParent = domNode.parentNode;
                        domParent.insertBefore(createNode(node), domNode);
                        for (domSize = oldNode.domSize || 1; domSize--;) {
                            nextDomNode = (domSize > 0) ? domNode.nextSibling : null;
                            domParent.removeChild(domNode);
                            domNode = nextDomNode;
                        }
                    }
                    break;
                default:
                    updateElement(domNode, oldNode.attrs, oldNode.events, node, tag, node.attrs, node.events);
                    updateChildren(domNode, node, oldChildren, normChildren(node, children, oldChildren));
            }
        }
        node.dom = domNode;
        return domNode;
    }

    function destroyNode(node) {
        var domNode = node.dom,
            events = node.events;
        if (events) {
            for (var eventType in events) {
                removeEventHandler(domNode, eventType);
            }
        }
        if (domNode.virtualNode) {
            domNode.virtualNode = undefined;
        }
        // TODO call callback
        var children = node.children;
        if (children) {
            if (isArray(children)) {
                for (var i = 0, len = children.length; i < len; i++) {
                    var child = children[i];
                    if (child.tag) {
                        destroyNode(child);
                    }
                }
            } else if (children.tag) {
                destroyNode(children);
            }
        }
    }

    function writeObject(source, target) {
        var key;
        for (key in source) {
            target[key] = source[key];
        }
        for (key in target) {
            if (source[key] === undefined) {
                target[key] = undefined;
            }
        }
    }

    var vdom = cito.vdom = {
        create: function (node) {
            node = norm(node);
            createNode(node);
            return node;
        },
        append: function (domParent, node) {
            node = vdom.create(node);
            domParent.appendChild(node.dom);
            return node;
        },
        update: function (oldNode, node) {
            node = norm(node, oldNode);
            updateNode(oldNode, node);
            writeObject(node, oldNode);
            return oldNode;
        },
        remove: function (node) {
            var domParent = node.dom.parentNode;
            removeChild(domParent, node);
        }
    };

})(cito, window);